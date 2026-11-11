// Server-only, unmounted, offline contract for an author's checklist review.
// Distinct from AI-candidate accept/reject (novelight_ai_review_decide).
// A durable, owner-scoped transactional CAS repository is NOT supplied here.
// Never mount without separately approved storage, Auth/session and RLS proof.
import '../../../novelight-ai-bible-author-workspace.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_ID = /^rv1-[0-9a-f]{16}$/;
const summary = globalThis.NovelightAiBibleAuthorWorkspace?.localReviewSummary;

function deny() {
  throw new Error('AI_OWNER_REVIEW_STATE_DENIED');
}

function unavailable() {
  throw new Error('AI_OWNER_REVIEW_STATE_UNAVAILABLE');
}

function positiveId(value) {
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value
        : '';
  if (!/^[1-9]\d*$/.test(raw)) deny();
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) deny();
  return id;
}

function validIds(value) {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => typeof id === 'string' && REVIEW_ID.test(id)) &&
    new Set(value).size === value.length
  );
}

function verifiedRow(row, actorId, novelId) {
  if (row === null) {
    return { version: 1, actorId, novelId, revision: 0, reviewedIds: [] };
  }
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    row.actorId !== actorId ||
    row.novelId !== novelId ||
    row.version !== 1 ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    !validIds(row.reviewedIds)
  ) {
    unavailable();
  }
  return row;
}

function publicSnapshot(row, checks) {
  const known = new Set(checks.map((check) => check.id));
  return {
    version: 1,
    novelId: row.novelId,
    revision: row.revision,
    reviewedIds: row.reviewedIds.filter((id) => known.has(id)).sort()
  };
}

// Deliberately reuses the exact deterministic UI checklist computation.
// Importing the browser module only registers pure functions on globalThis;
// this server-side operation never renders a DOM or executes a model.
export function createOfflineOwnerBibleReviewStateWorkflow({
  enabled = false,
  ownerId,
  authClient,
  serviceClient,
  readOwnerPreview,
  repository
} = {}) {
  if (
    typeof summary !== 'function' ||
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof authClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof readOwnerPreview !== 'function' ||
    typeof repository?.readSnapshot !== 'function' ||
    typeof repository?.compareAndSwap !== 'function'
  ) {
    unavailable();
  }
  const allowedOwnerId = ownerId.toLowerCase();

  async function authenticate(token) {
    if (!enabled) throw new Error('AI_OWNER_REVIEW_STATE_DISABLED');
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/.test(token)
    ) {
      deny();
    }
    const result = await authClient.auth.getUser(token);
    const actorId = result?.data?.user?.id;
    if (
      result?.error ||
      typeof actorId !== 'string' ||
      !UUID.test(actorId) ||
      actorId.toLowerCase() !== allowedOwnerId
    ) {
      deny();
    }
    return actorId.toLowerCase();
  }

  async function authorize(token, requestedNovelId) {
    const actorId = await authenticate(token);
    const novelId = positiveId(requestedNovelId);
    const { data, error } = await serviceClient
      .from('novels')
      .select('id,user_id')
      .eq('id', novelId)
      .maybeSingle();
    if (
      error ||
      !data ||
      positiveId(data.id) !== novelId ||
      typeof data.user_id !== 'string' ||
      data.user_id.toLowerCase() !== actorId
    ) {
      deny();
    }
    // Trusted SERVER-ONLY preview must independently authorize the bearer
    // and verify the same owner/work; no browser-submitted preview is accepted.
    const preview = await readOwnerPreview({ actorId, novelId, token });
    if (
      !preview ||
      preview.novelId !== novelId ||
      preview.aiGenerated !== false ||
      !Array.isArray(preview.characters) ||
      !Array.isArray(preview.notes) ||
      !Array.isArray(preview.facts) ||
      Object.hasOwn(preview, 'candidates')
    ) {
      deny();
    }
    const checks = summary(preview)?.checks;
    if (
      !Array.isArray(checks) ||
      checks.length > 100 ||
      checks.some((check) => !REVIEW_ID.test(check?.id)) ||
      new Set(checks.map((check) => check.id)).size !== checks.length
    ) {
      unavailable();
    }
    return { actorId, novelId, checks };
  }

  async function read({ token, novelId }) {
    const scope = await authorize(token, novelId);
    const row = verifiedRow(
      await repository.readSnapshot({
        actorId: scope.actorId,
        novelId: scope.novelId,
        bearerToken: token
      }),
      scope.actorId,
      scope.novelId
    );
    return publicSnapshot(row, scope.checks);
  }

  async function save({
    token,
    novelId,
    expectedRevision,
    reviewedIds,
    explicitAuthorAction
  }) {
    if (
      explicitAuthorAction !== true ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      !validIds(reviewedIds)
    ) {
      deny();
    }
    const scope = await authorize(token, novelId);
    const known = new Set(scope.checks.map((check) => check.id));
    if (reviewedIds.some((id) => !known.has(id))) {
      throw new Error('AI_OWNER_REVIEW_STATE_STALE');
    }
    const previous = verifiedRow(
      await repository.readSnapshot({
        actorId: scope.actorId,
        novelId: scope.novelId,
        bearerToken: token
      }),
      scope.actorId,
      scope.novelId
    );
    if (previous.revision !== expectedRevision) {
      throw new Error('AI_OWNER_REVIEW_STATE_CONFLICT');
    }
    // Session must still be valid before the durable, atomic repository call.
    // The future DB-side CAS must independently recheck scope/ownership.
    if ((await authenticate(token)) !== scope.actorId) deny();
    let saved;
    try {
      saved = await repository.compareAndSwap({
        actorId: scope.actorId,
        novelId: scope.novelId,
        expectedRevision,
        reviewedIds: [...reviewedIds].sort(),
        bearerToken: token
      });
    } catch {
      unavailable();
    }
    if (saved === null) {
      throw new Error('AI_OWNER_REVIEW_STATE_CONFLICT');
    }
    const row = verifiedRow(saved, scope.actorId, scope.novelId);
    if (
      row.revision !== expectedRevision + 1 ||
      row.reviewedIds.length !== reviewedIds.length ||
      row.reviewedIds.some((id) => !known.has(id) || !reviewedIds.includes(id))
    ) {
      unavailable();
    }
    return publicSnapshot(row, scope.checks);
  }

  return Object.freeze({ read, save });
}
