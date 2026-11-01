// 02-07-05: read-only, fail-closed validation of the GitHub OWNER
// CLAIMED/CONSUMED ledger. This module never fetches, posts, claims, pays,
// deletes, retries or changes a workflow. An independently audited transport
// must supply a complete REST snapshot from GitHub Issue #294.
const REPO = 'bingohooah888-ai/novelrise';
const ISSUE = 294;
const TITLE = '[Staging Control] Supabase migration sync';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
const OWNER = 'bingohooah888-ai';
const OWNER_ID = 317436651;
const BOT = 'github-actions[bot]';
const BOT_ID = 41898282;
const SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APPROVAL_KEYS = [
  'actorId', 'approvalScope', 'capMicros', 'confirmation',
  'consentRevision', 'episodeId', 'expiresAt', 'mainSha',
  'model', 'novelId', 'previewDeploymentId', 'provider',
  'stagingProjectRef'
].sort();
const CLAIM_KEYS = [
  'approvalCommentId', 'mainSha', 'previewDeploymentId', 'runId'
].sort();
const CONSUME_KEYS = ['approvalCommentId', 'result', 'runId'].sort();
const RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);

function deny() {
  throw new Error('AI_020705_READONLY_OWNER_LEDGER_DENIED');
}
function exactKeys(x, keys) {
  return x && typeof x === 'object' && !Array.isArray(x) &&
    JSON.stringify(Object.keys(x).sort()) === JSON.stringify(keys);
}
function parseEntry(body, kind, keys) {
  if (typeof body !== 'string' ||
      !body.startsWith(PREFIX + kind + ' ') ||
      body.length > 4096) deny();
  try {
    const parsed = JSON.parse(body.slice((PREFIX + kind + ' ').length));
    if (!exactKeys(parsed, keys)) deny();
    return parsed;
  } catch {
    deny();
  }
}
function userIs(x, login, id, type) {
  return x?.user?.login === login &&
    x?.user?.id === id &&
    x?.user?.type === type;
}
function unedited(x) {
  return typeof x?.created_at === 'string' &&
    x.created_at === x.updated_at &&
    Number.isFinite(Date.parse(x.created_at));
}
function validScope(s) {
  return s?.repository === REPO &&
    s?.issueNumber === ISSUE &&
    Number.isSafeInteger(s.approvalCommentId) && s.approvalCommentId > 0 &&
    Number.isSafeInteger(s.runId) && s.runId > 0 &&
    SHA.test(s.mainSha ?? '') &&
    DEPLOYMENT.test(s.previewDeploymentId ?? '') &&
    UUID.test(s.actorId ?? '') &&
    Number.isSafeInteger(s.novelId) && s.novelId > 0 &&
    Number.isSafeInteger(s.episodeId) && s.episodeId > 0 &&
    s.provider === 'openai' && s.model === 'gpt-5.6-luna' &&
    s.stagingProjectRef === 'wmlzjgvxgoyrovdhbqbg' &&
    Number.isSafeInteger(s.capMicros) &&
    s.capMicros >= 1 && s.capMicros <= 10000000 &&
    typeof s.consentRevision === 'string' &&
    /^[a-z0-9][a-z0-9._-]{3,119}$/iu.test(s.consentRevision);
}

/**
 * Input contract for a separate read-only GitHub REST adapter:
 * snapshot.issue is a fresh GET /repos/.../issues/294 result;
 * snapshot.pages are ALL GET /issues/294/comments pages, per_page=100,
 * in ascending API order, with the issue comment count rechecked afterward.
 * Authenticated origin, race-free pagination and freshness MUST be enforced
 * by that adapter. Self-declared snapshot fields are never authority to spend.
 */
export function inspect020705ReadOnlyOwnerLedger({
  snapshot, scope, now = Date.now()
} = {}) {
  if (!validScope(scope) ||
      !Number.isFinite(now) ||
      !snapshot ||
      snapshot.repository !== REPO ||
      snapshot.issue?.number !== ISSUE ||
      snapshot.issue?.title !== TITLE ||
      snapshot.issue?.state !== 'open' ||
      snapshot.issue?.pull_request != null ||
      !Number.isSafeInteger(snapshot.issue?.comments) ||
      snapshot.issue.comments < 1 ||
      snapshot.issue.comments > 10000 ||
      !Number.isFinite(snapshot.observedAtMs) ||
      snapshot.observedAtMs > now ||
      now - snapshot.observedAtMs > 300000 ||
      snapshot.commentsCountAfterFetch !== snapshot.issue.comments ||
      !Array.isArray(snapshot.pages) ||
      snapshot.pages.length !== Math.ceil(snapshot.issue.comments / 100)
  ) deny();

  const comments = [];
  let previousId = 0;
  let previousDate = -Infinity;
  for (const [index, page] of snapshot.pages.entries()) {
    const expectedCount = Math.min(100, snapshot.issue.comments - index * 100);
    if (page?.number !== index + 1 ||
        !Array.isArray(page.comments) ||
        page.comments.length !== expectedCount) deny();
    for (const c of page.comments) {
      if (!Number.isSafeInteger(c?.id) || c.id <= previousId ||
          !unedited(c) ||
          Date.parse(c.created_at) < previousDate ||
          typeof c.body !== 'string' || c.body.length > 4096) deny();
      previousId = c.id;
      previousDate = Date.parse(c.created_at);
      comments.push(c);
    }
  }
  if (comments.length !== snapshot.issue.comments) deny();

  const approvals = comments.filter(c => c.id === scope.approvalCommentId);
  if (approvals.length !== 1 ||
      !userIs(approvals[0], OWNER, OWNER_ID, 'User') ||
      approvals[0].author_association !== 'OWNER') deny();
  const approval = parseEntry(approvals[0].body, 'APPROVE', APPROVAL_KEYS);
  if (approval.confirmation !== 'STAGING PAID 1 CALL APPROVED' ||
      approval.approvalScope !== 'synthetic-one-provider-one-call-only' ||
      approval.mainSha !== scope.mainSha ||
      approval.previewDeploymentId !== scope.previewDeploymentId ||
      approval.actorId !== scope.actorId ||
      approval.novelId !== scope.novelId ||
      approval.episodeId !== scope.episodeId ||
      approval.provider !== scope.provider ||
      approval.model !== scope.model ||
      approval.capMicros !== scope.capMicros ||
      approval.consentRevision !== scope.consentRevision ||
      approval.stagingProjectRef !== scope.stagingProjectRef ||
      !Number.isFinite(Date.parse(approval.expiresAt)) ||
      Date.parse(approval.expiresAt) <= Date.parse(approvals[0].created_at) ||
      Date.parse(approval.expiresAt) - Date.parse(approvals[0].created_at) >
        3600000) deny();

  let claim = null;
  let consumed = null;
  for (const c of comments) {
    if (!c.body.startsWith(PREFIX)) continue;
    if (c.id === scope.approvalCommentId) continue;
    const kind = c.body.startsWith(PREFIX + 'CLAIMED ')
      ? 'CLAIMED' : c.body.startsWith(PREFIX + 'CONSUMED ')
        ? 'CONSUMED' : c.body.startsWith(PREFIX + 'APPROVE ')
          ? 'APPROVE' : null;
    if (!kind) deny();
    // A different correctly structured OWNER approval does not belong to
    // the target run, but malformed ledger markers cannot be ignored.
    if (kind === 'APPROVE') {
      if (!userIs(c, OWNER, OWNER_ID, 'User') ||
          c.author_association !== 'OWNER') deny();
      parseEntry(c.body, kind, APPROVAL_KEYS);
      continue;
    }
    const row = parseEntry(c.body, kind,
      kind === 'CLAIMED' ? CLAIM_KEYS : CONSUME_KEYS);
    if (!Number.isSafeInteger(row.approvalCommentId) ||
        row.approvalCommentId < 1 ||
        !Number.isSafeInteger(row.runId) || row.runId < 1 ||
        !userIs(c, BOT, BOT_ID, 'Bot')) deny();
    if (kind === 'CLAIMED' &&
        (!SHA.test(row.mainSha) ||
         !DEPLOYMENT.test(row.previewDeploymentId))) deny();
    if (kind === 'CONSUMED' && !RESULTS.has(row.result)) deny();
    if (row.approvalCommentId !== scope.approvalCommentId) continue;
    if (row.runId !== scope.runId ||
        c.id <= scope.approvalCommentId) deny();
    if (kind === 'CLAIMED') {
      if (claim || consumed ||
          row.mainSha !== scope.mainSha ||
          row.previewDeploymentId !== scope.previewDeploymentId) deny();
      claim = c;
    } else {
      if (!claim || consumed || c.id <= claim.id) deny();
      consumed = { comment: c, result: row.result };
    }
  }
  return Object.freeze({
    status: consumed ? 'CONSUMED' : claim ? 'CLAIMED' : 'UNCLAIMED',
    claimed: Boolean(claim),
    consumed: Boolean(consumed),
    result: consumed?.result ?? null,
    approvalCommentId: scope.approvalCommentId,
    runId: scope.runId,
    mainSha: scope.mainSha,
    previewDeploymentId: scope.previewDeploymentId,
    observedAtMs: snapshot.observedAtMs,
    noPaidRetry: true,
    authorizesPaidCall: false
  });
}
