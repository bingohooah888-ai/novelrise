// 02-07-05 GitHub OWNER approval ledger, without HTTP or secrets.
// A protected single-concurrency workflow must supply readComments/writeComment.
// This is NOT authority to execute a paid trial, create Preview or change DB.
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
const USER = 'bingohooah888-ai';
const SHA = /^[a-f0-9]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APPROVAL_KEYS = [
  'actorId', 'approvalScope', 'capMicros', 'confirmation',
  'consentRevision', 'episodeId', 'expiresAt', 'mainSha',
  'model', 'novelId', 'previewDeploymentId', 'provider',
  'stagingProjectRef'
].sort();

function deny() {
  throw new Error('AI_020705_OWNER_LEDGER_DENIED');
}

function exactKeys(obj, keys) {
  return (
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(keys)
  );
}

function payload(body, suffix) {
  if (typeof body !== 'string' || !body.startsWith(PREFIX + suffix + ' ')) {
    return null;
  }
  try {
    return JSON.parse(body.slice((PREFIX + suffix + ' ').length));
  } catch {
    return null;
  }
}

function isOwner(comment) {
  return comment?.user?.login === USER &&
    comment?.author_association === 'OWNER';
}

export function inspect020705OwnerLedger({ comments, approvalCommentId, expected, now }) {
  if (
    !Array.isArray(comments) ||
    !Number.isSafeInteger(approvalCommentId) ||
    approvalCommentId < 1 ||
    !Number.isFinite(now) ||
    !expected ||
    typeof expected !== 'object'
  ) {
    deny();
  }
  const approvals = comments.filter((c) => c?.id === approvalCommentId);
  if (approvals.length !== 1 || !isOwner(approvals[0])) deny();
  const approved = payload(approvals[0].body, 'APPROVE');
  const expiry = Date.parse(approved?.expiresAt);
  if (
    !exactKeys(approved, APPROVAL_KEYS) ||
    approved.confirmation !== 'STAGING PAID 1 CALL APPROVED' ||
    approved.approvalScope !== 'synthetic-one-provider-one-call-only' ||
    approved.provider !== 'openai' ||
    approved.model !== 'gpt-5.6-luna' ||
    approved.stagingProjectRef !== 'wmlzjgvxgoyrovdhbqbg' ||
    !SHA.test(approved.mainSha) ||
    !DEPLOYMENT.test(approved.previewDeploymentId) ||
    !UUID.test(approved.actorId) ||
    !Number.isSafeInteger(approved.novelId) || approved.novelId < 1 ||
    !Number.isSafeInteger(approved.episodeId) || approved.episodeId < 1 ||
    !Number.isSafeInteger(approved.capMicros) ||
    approved.capMicros < 1 || approved.capMicros > 10000000 ||
    typeof approved.consentRevision !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{3,119}$/iu.test(approved.consentRevision) ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry - now > 3600000 ||
    Object.entries(expected).some(([key, value]) => approved[key] !== value)
  ) {
    deny();
  }
  const entries = comments.filter((c) =>
    typeof c?.body === 'string' &&
    (c.body.startsWith(PREFIX + 'CLAIMED ') ||
      c.body.startsWith(PREFIX + 'CONSUMED '))
  );
  for (const entry of entries) {
    // Treat ANY claim/consume for this comment ID as used, not just one
    // that happens to match today's SHA/scope. Fail closed on malformed
    // ledger entries, never silently ignore a possible replay marker.
    const suffix = entry.body.startsWith(PREFIX + 'CLAIMED ')
      ? 'CLAIMED'
      : 'CONSUMED';
    const data = payload(entry.body, suffix);
    if (!data || !Number.isSafeInteger(data.approvalCommentId)) deny();
    if (data.approvalCommentId === approvalCommentId) deny();
  }
  return Object.freeze({
    approvalCommentId,
    mainSha: approved.mainSha,
    previewDeploymentId: approved.previewDeploymentId,
    expiresAt: approved.expiresAt,
    capMicros: approved.capMicros,
    provider: approved.provider,
    model: approved.model,
    ownerLedgerClaimed: false,
    authorizesPaidCall: false
  });
}

// Call ONLY under a GitHub Actions concurrency group serializing the
// entire OWNER approval issue. Unique DB claim remains mandatory as a
// second atomic line of defence across HTTP/serverless requests.
export async function claim020705OwnerApproval({
  readComments,
  writeComment,
  approvalCommentId,
  expected,
  runId,
  now = Date.now
} = {}) {
  if (
    typeof readComments !== 'function' ||
    typeof writeComment !== 'function' ||
    !Number.isSafeInteger(runId) || runId < 1
  ) {
    deny();
  }
  const snapshot = inspect020705OwnerLedger({
    comments: await readComments(),
    approvalCommentId,
    expected,
    now: now()
  });
  const claim = {
    approvalCommentId,
    mainSha: snapshot.mainSha,
    previewDeploymentId: snapshot.previewDeploymentId,
    runId
  };
  await writeComment(PREFIX + 'CLAIMED ' + JSON.stringify(claim));
  const matching = (await readComments()).filter((comment) => {
    const data = payload(comment?.body, 'CLAIMED');
    return data?.approvalCommentId === approvalCommentId;
  });
  if (
    matching.length !== 1 ||
    matching[0].user?.login !== 'github-actions[bot]' ||
    matching[0].body !== PREFIX + 'CLAIMED ' + JSON.stringify(claim)
  ) {
    deny();
  }
  return Object.freeze({ ...snapshot, ownerLedgerClaimed: true });
}

export async function consume020705OwnerApproval({
  writeComment, approvalCommentId, runId, result
} = {}) {
  if (
    typeof writeComment !== 'function' ||
    !Number.isSafeInteger(approvalCommentId) || approvalCommentId < 1 ||
    !Number.isSafeInteger(runId) || runId < 1 ||
    !['success', 'failure', 'cancelled', 'skipped'].includes(result)
  ) {
    deny();
  }
  await writeComment(
    PREFIX + 'CONSUMED ' +
      JSON.stringify({ approvalCommentId, runId, result })
  );
}
