// Phase 02-07-05: dormant, server-only per-chunk completion journal.
// Reuses novelight_ai_episode_analysis.summary; never creates a table, route,
// client, provider or credentials. OFF until the owner-only trial explicitly
// injects this capability. Writes require an existing trusted CAS adapter.
import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = 'novelightPhase2';
const ZERO_REASONS = new Set(['deletion-only', 'title-only', 'empty-body']);
// A first-time partial journal is not a completed analysis checkpoint.
export const NOVEL_BIBLE_PENDING_SOURCE_HASH = '0'.repeat(64);

function unavailable() {
  throw new Error('AI_BIBLE_CHECKPOINT_UNAVAILABLE');
}

function conflict() {
  throw new Error('AI_BIBLE_CHECKPOINT_CONFLICT');
}

function validId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

function validPlan(plan, actorId, novelId, episodeId, chunkIndex) {
  if (
    !UUID.test(actorId) ||
    !validId(novelId) ||
    !validId(episodeId) ||
    !plan ||
    plan.novelId !== novelId ||
    !Array.isArray(plan.chunks) ||
    plan.chunks.length < 1 ||
    plan.chunks.length > 64 ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= plan.chunks.length ||
    plan.chunks.some(
      (chunk) =>
        chunk.episodeId !== episodeId ||
        !SHA.test(chunk.sourceHash) ||
        chunk.sourceHash !== plan.chunks[0].sourceHash ||
        !SHA.test(chunk.chunkHash) ||
        !Number.isSafeInteger(chunk.start) ||
        !Number.isSafeInteger(chunk.end) ||
        chunk.start < 0 ||
        chunk.end <= chunk.start
    ) ||
    !Array.isArray(plan.analyses) ||
    plan.analyses.length > 1 ||
    (plan.analyses.length === 1 &&
      (plan.analyses[0].episode_id !== episodeId ||
        !SHA.test(plan.analyses[0].source_hash)))
  ) {
    unavailable();
  }
  const sourceHash = plan.chunks[0].sourceHash;
  if (sourceHash === NOVEL_BIBLE_PENDING_SOURCE_HASH) unavailable();
  const previousSourceHash = plan.analyses[0]?.source_hash ?? null;
  const parts = plan.chunks.map((part) => [
    part.start,
    part.end,
    part.chunkHash
  ]);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        actorId.toLowerCase(),
        novelId,
        episodeId,
        previousSourceHash,
        sourceHash,
        parts
      ])
    )
    .digest('hex');
  return {
    actorId: actorId.toLowerCase(),
    novelId,
    episodeId,
    sourceHash,
    previousSourceHash,
    fingerprint,
    chunkCount: parts.length,
    chunkIndex
  };
}

// A zero-excerpt change must be proven by the trusted changed-chunk planner.
// This metadata contains only hashes and IDs, never manuscript content.
function validZeroPlan(plan, actorId, novelId, episodeId) {
  if (
    typeof actorId !== 'string' ||
    !UUID.test(actorId) ||
    !validId(novelId) ||
    !validId(episodeId) ||
    !plan ||
    plan.novelId !== novelId ||
    !Array.isArray(plan.chunks) ||
    plan.chunks.length !== 0 ||
    plan.unchangedCount !== 0 ||
    plan.deferredEpisodeCount !== 0 ||
    !Array.isArray(plan.zeroChangedSources) ||
    plan.zeroChangedSources.length !== 1 ||
    !Array.isArray(plan.analyses) ||
    plan.analyses.length > 1
  ) {
    unavailable();
  }
  const zero = plan.zeroChangedSources[0];
  const expectedGroup = {
    'deletion-only': plan.deletionOnlyEpisodes,
    'title-only': plan.titleOnlyEpisodes,
    'empty-body': plan.emptyChangedEpisodes
  }[zero?.reason];
  if (
    !ZERO_REASONS.has(zero?.reason) ||
    zero.episodeId !== episodeId ||
    !SHA.test(zero.sourceHash) ||
    zero.sourceHash === NOVEL_BIBLE_PENDING_SOURCE_HASH ||
    !Array.isArray(expectedGroup) ||
    expectedGroup.length !== 1 ||
    expectedGroup[0] !== episodeId ||
    (plan.analyses.length === 1 &&
      (plan.analyses[0].episode_id !== episodeId ||
        !SHA.test(plan.analyses[0].source_hash)))
  ) {
    unavailable();
  }
  const previousSourceHash = plan.analyses[0]?.source_hash ?? null;
  if (previousSourceHash === NOVEL_BIBLE_PENDING_SOURCE_HASH) unavailable();
  const owner = actorId.toLowerCase();
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        owner,
        novelId,
        episodeId,
        previousSourceHash,
        zero.sourceHash,
        zero.reason,
        []
      ])
    )
    .digest('hex');
  return {
    actorId: owner,
    novelId,
    episodeId,
    sourceHash: zero.sourceHash,
    previousSourceHash,
    fingerprint,
    chunkCount: 0,
    zeroReason: zero.reason
  };
}

function validCompleted(values, count) {
  return (
    Array.isArray(values) &&
    values.length <= count &&
    values.every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value < count
    ) &&
    new Set(values).size === values.length
  );
}

function validateRow(row, scope) {
  if (row === null) return null;
  if (
    !row ||
    typeof row !== 'object' ||
    row.episode_id !== scope.episodeId ||
    !SHA.test(row.source_hash) ||
    !validId(row.revision) ||
    !row.summary ||
    typeof row.summary !== 'object' ||
    Array.isArray(row.summary)
  ) {
    unavailable();
  }
  const progress = row.summary[KEY];
  if (progress === undefined) {
    return { row, progress: null };
  }
  if (
    !progress ||
    progress.version !== 1 ||
    !['in_progress', 'complete'].includes(progress.state) ||
    progress.actorId !== scope.actorId ||
    progress.novelId !== scope.novelId ||
    progress.episodeId !== scope.episodeId ||
    !SHA.test(progress.targetSourceHash) ||
    (progress.previousSourceHash !== null &&
      !SHA.test(progress.previousSourceHash)) ||
    !SHA.test(progress.fingerprint) ||
    !Number.isSafeInteger(progress.chunkCount) ||
    (progress.chunkCount < 1 &&
      (progress.chunkCount !== 0 ||
        progress.state !== 'complete' ||
        !ZERO_REASONS.has(progress.zeroReason))) ||
    progress.chunkCount > 64 ||
    !validCompleted(progress.completedIndices, progress.chunkCount) ||
    (progress.state === 'complete' &&
      (row.source_hash !== progress.targetSourceHash ||
        progress.completedIndices.length !== progress.chunkCount)) ||
    (progress.state === 'in_progress' &&
      row.source_hash !==
        (progress.previousSourceHash ?? NOVEL_BIBLE_PENDING_SOURCE_HASH))
  ) {
    unavailable();
  }
  return { row, progress };
}

function requireMatchingPlan(snapshot, scope) {
  if (!snapshot) return null;
  const { row, progress } = snapshot;
  if (!progress) {
    if (
      row.source_hash !== scope.previousSourceHash &&
      row.source_hash !== scope.sourceHash
    ) {
      conflict();
    }
    return null;
  }
  if (
    progress.targetSourceHash !== scope.sourceHash ||
    progress.previousSourceHash !== scope.previousSourceHash ||
    progress.fingerprint !== scope.fingerprint ||
    progress.chunkCount !== scope.chunkCount
  ) {
    // Another source revision or plan is in progress: never inherit its
    // partial approvals, even if a later chapter happens to hash alike.
    if (progress.state === 'complete') {
      if (row.source_hash === scope.sourceHash) return { completed: true };
      // The prior completed version is the baseline for a NEW revision.
      if (row.source_hash === scope.previousSourceHash) return null;
    }
    if (
      progress.state === 'in_progress' &&
      progress.previousSourceHash === scope.previousSourceHash
    ) {
      // The previous in-progress excerpt list was invalidated by a fresh
      // server-authorized manuscript revision. Discard only with CAS.
      return { replan: true };
    }
    conflict();
  }
  return progress;
}

// readSnapshot/compareAndSwap are trusted server-side persistence contracts.
// compareAndSwap MUST apply expected revision and unique episode PK atomically.
// This workflow does not automatically retry an uncertain paid execution.
export function createOfflineOwnerNovelBibleCheckpoint({
  enabled = false,
  repository
} = {}) {
  if (
    typeof repository?.readSnapshot !== 'function' ||
    typeof repository?.compareAndSwap !== 'function'
  ) {
    unavailable();
  }

  async function inspect({ actorId, novelId, episodeId, plan, chunkIndex }) {
    if (!enabled) throw new Error('AI_BIBLE_CHECKPOINT_DISABLED');
    const scope = validPlan(plan, actorId, novelId, episodeId, chunkIndex);
    const snapshot = validateRow(await repository.readSnapshot(scope), scope);
    const progress = requireMatchingPlan(snapshot, scope);
    if (progress?.completed) return 'completed';
    if (progress?.replan) return 'replan';
    if (
      progress?.state === 'complete' ||
      progress?.completedIndices?.includes(chunkIndex) ||
      (!progress && snapshot?.row.source_hash === scope.sourceHash)
    ) {
      return 'completed';
    }
    return 'pending';
  }

  async function record({ actorId, novelId, episodeId, plan, chunkIndex }) {
    if (!enabled) throw new Error('AI_BIBLE_CHECKPOINT_DISABLED');
    const scope = validPlan(plan, actorId, novelId, episodeId, chunkIndex);
    const snapshot = validateRow(await repository.readSnapshot(scope), scope);
    const progress = requireMatchingPlan(snapshot, scope);
    if (progress?.replan) conflict();
    if (
      progress?.completed ||
      progress?.state === 'complete' ||
      progress?.completedIndices?.includes(chunkIndex) ||
      (!progress && snapshot?.row.source_hash === scope.sourceHash)
    ) {
      const complete =
        progress?.completed === true ||
        progress?.state === 'complete' ||
        (!progress && snapshot?.row.source_hash === scope.sourceHash);
      return {
        complete,
        alreadyRecorded: true,
        remainingChunks: complete
          ? 0
          : scope.chunkCount - progress.completedIndices.length
      };
    }
    const completedIndices = [
      ...(progress?.completedIndices ?? []),
      chunkIndex
    ].sort((a, b) => a - b);
    const complete = completedIndices.length === scope.chunkCount;
    const next = {
      version: 1,
      state: complete ? 'complete' : 'in_progress',
      actorId: scope.actorId,
      novelId,
      episodeId,
      previousSourceHash: scope.previousSourceHash,
      targetSourceHash: scope.sourceHash,
      fingerprint: scope.fingerprint,
      chunkCount: scope.chunkCount,
      completedIndices
    };
    // A first insert must be an ordinary unique-PK INSERT (never UPSERT).
    // Existing rows require an atomic revision CAS, not read/overwrite.
    let saved;
    try {
      saved = await repository.compareAndSwap({
        ...scope,
        expectedRevision: snapshot?.row.revision ?? null,
        expectedSourceHash: snapshot?.row.source_hash ?? null,
        nextSourceHash: complete
          ? scope.sourceHash
          : (scope.previousSourceHash ?? NOVEL_BIBLE_PENDING_SOURCE_HASH),
        nextSummary: {
          ...(snapshot?.row.summary ?? {}),
          [KEY]: next
        }
      });
    } catch {
      unavailable();
    }
    if (saved === null) conflict();
    const verified = validateRow(saved, scope);
    if (
      !verified ||
      verified.row.revision !== (snapshot?.row.revision ?? 0) + 1 ||
      verified.row.source_hash !==
        (complete
          ? scope.sourceHash
          : (scope.previousSourceHash ?? NOVEL_BIBLE_PENDING_SOURCE_HASH)) ||
      JSON.stringify(verified.progress) !== JSON.stringify(next)
    ) {
      unavailable();
    }
    return {
      complete,
      alreadyRecorded: false,
      remainingChunks: scope.chunkCount - completedIndices.length
    };
  }

  // Reset only an unfinished, owner-matched journal with the SAME verified
  // completed baseline. The old chunk indices cannot carry across revisions.
  // No provider call is made here. A concurrent old record will lose CAS.
  async function replan({ actorId, novelId, episodeId, plan, chunkIndex }) {
    if (!enabled) throw new Error('AI_BIBLE_CHECKPOINT_DISABLED');
    const scope = validPlan(plan, actorId, novelId, episodeId, chunkIndex);
    const snapshot = validateRow(await repository.readSnapshot(scope), scope);
    const progress = requireMatchingPlan(snapshot, scope);
    if (!progress?.replan || !snapshot) conflict();
    const next = {
      version: 1,
      state: 'in_progress',
      actorId: scope.actorId,
      novelId,
      episodeId,
      previousSourceHash: scope.previousSourceHash,
      targetSourceHash: scope.sourceHash,
      fingerprint: scope.fingerprint,
      chunkCount: scope.chunkCount,
      completedIndices: []
    };
    const nextSourceHash =
      scope.previousSourceHash ?? NOVEL_BIBLE_PENDING_SOURCE_HASH;
    let saved;
    try {
      saved = await repository.compareAndSwap({
        ...scope,
        expectedRevision: snapshot.row.revision,
        expectedSourceHash: snapshot.row.source_hash,
        nextSourceHash,
        nextSummary: { ...snapshot.row.summary, [KEY]: next }
      });
    } catch {
      unavailable();
    }
    if (saved === null) conflict();
    const verified = validateRow(saved, scope);
    if (
      !verified ||
      verified.row.revision !== snapshot.row.revision + 1 ||
      verified.row.source_hash !== nextSourceHash ||
      JSON.stringify(verified.progress) !== JSON.stringify(next)
    ) {
      unavailable();
    }
    return { replanned: true, remainingChunks: scope.chunkCount };
  }

  // A deletion-only, title-only or empty-body change has no model input.
  // After the caller rechecks the authoritative owner, chapter and consent,
  // promote the hash through the SAME revision-guarded repository, with a
  // completed zero-chunk marker. Never copy stale partial chunk approvals.
  async function completeEmpty({ actorId, novelId, episodeId, plan }) {
    if (!enabled) throw new Error('AI_BIBLE_CHECKPOINT_DISABLED');
    const scope = validZeroPlan(plan, actorId, novelId, episodeId);
    const snapshot = validateRow(await repository.readSnapshot(scope), scope);
    const progress = requireMatchingPlan(snapshot, scope);
    if (
      progress?.completed ||
      progress?.state === 'complete' ||
      (!progress && snapshot?.row.source_hash === scope.sourceHash)
    ) {
      return { complete: true, alreadyRecorded: true, remainingChunks: 0 };
    }
    const next = {
      version: 1,
      state: 'complete',
      actorId: scope.actorId,
      novelId,
      episodeId,
      previousSourceHash: scope.previousSourceHash,
      targetSourceHash: scope.sourceHash,
      fingerprint: scope.fingerprint,
      chunkCount: 0,
      zeroReason: scope.zeroReason,
      completedIndices: []
    };
    let saved;
    try {
      saved = await repository.compareAndSwap({
        ...scope,
        expectedRevision: snapshot?.row.revision ?? null,
        expectedSourceHash: snapshot?.row.source_hash ?? null,
        nextSourceHash: scope.sourceHash,
        nextSummary: { ...(snapshot?.row.summary ?? {}), [KEY]: next }
      });
    } catch {
      unavailable();
    }
    if (saved === null) conflict();
    const verified = validateRow(saved, scope);
    if (
      !verified ||
      verified.row.revision !== (snapshot?.row.revision ?? 0) + 1 ||
      verified.row.source_hash !== scope.sourceHash ||
      JSON.stringify(verified.progress) !== JSON.stringify(next)
    ) {
      unavailable();
    }
    return { complete: true, alreadyRecorded: false, remainingChunks: 0 };
  }

  return Object.freeze({ inspect, record, replan, completeEmpty });
}

// Existing-table adapter: never used by a public route. The authoritative
// scope and fresh source are rechecked by the one-shot model bridge.
// The final DB-level source-lock/ownership proof remains part of gated
// Staging validation; no current release activates this writer.
export function createSupabaseOwnerNovelBibleCheckpointRepository({
  serviceClient
} = {}) {
  if (typeof serviceClient?.from !== 'function') unavailable();

  return Object.freeze({
    async readSnapshot({ episodeId }) {
      if (!validId(episodeId)) unavailable();
      const { data, error } = await serviceClient
        .from('novelight_ai_episode_analysis')
        .select('episode_id,source_hash,revision,summary')
        .eq('episode_id', episodeId)
        .maybeSingle();
      if (error) unavailable();
      return data;
    },
    async compareAndSwap({
      episodeId,
      expectedRevision,
      expectedSourceHash,
      nextSourceHash,
      nextSummary
    }) {
      if (
        !validId(episodeId) ||
        !SHA.test(nextSourceHash) ||
        !nextSummary ||
        typeof nextSummary !== 'object'
      ) {
        unavailable();
      }
      let result;
      const nextRevision = (expectedRevision ?? 0) + 1;
      if (expectedRevision === null && expectedSourceHash === null) {
        result = await serviceClient
          .from('novelight_ai_episode_analysis')
          .insert({
            episode_id: episodeId,
            source_hash: nextSourceHash,
            summary: nextSummary,
            revision: nextRevision
          })
          .select('episode_id,source_hash,revision,summary')
          .maybeSingle();
      } else {
        if (!validId(expectedRevision) || !SHA.test(expectedSourceHash)) {
          unavailable();
        }
        result = await serviceClient
          .from('novelight_ai_episode_analysis')
          .update({
            source_hash: nextSourceHash,
            summary: nextSummary,
            revision: nextRevision,
            analyzed_at: new Date().toISOString()
          })
          .eq('episode_id', episodeId)
          .eq('revision', expectedRevision)
          .eq('source_hash', expectedSourceHash)
          .select('episode_id,source_hash,revision,summary')
          .maybeSingle();
      }
      if (result?.error?.code === '23505') return null;
      if (result?.error) unavailable();
      return result?.data ?? null;
    }
  });
}
