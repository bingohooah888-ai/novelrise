// One-run signed cleanup registration transport for a future trusted executor.
// No automatic execution, branch creation, preview, or OWNER grant here.
// A protected runner supplies a separately verified independent watchdog.
import {
  signCommunityWatchIntent,
  verifyCommunityWatchIntent
} from './community-hosted-expiry-watchdog.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const API = 'https://api.github.com/repos/' + REPO;
const SUPABASE = 'https://api.supabase.com/v1/projects/';
const PARENT = 'fiepaguycecrredwrcwx';
const ID = /^[1-9][0-9]*$/u;
const SHA = /^[a-f0-9]{40}$/u;

function deny() {
  throw new Error('COMMUNITY_WATCH_REGISTRATION_DENIED');
}
async function requestJson(fetchImpl, url, token, method = 'GET', body) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    // A timed-out POST may have created a comment. NEVER retry automatically.
    deny();
  }
  if (response?.status !== (method === 'POST' ? 201 : 200)) deny();
  try {
    return await response.json();
  } catch {
    deny();
  }
}
function validate(grant, run, claim, evidence, now) {
  if (
    run?.repository !== REPO ||
    run.scope !== 'community-phase1-hosted-authenticated-write' ||
    !SHA.test(run.mainSha ?? '') ||
    !SHA.test(run.candidateSha ?? '') ||
    run.mainSha === run.candidateSha ||
    !ID.test(run.runId ?? '') ||
    !ID.test(run.requestCommentId ?? '') ||
    grant?.status !== 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW' ||
    grant.runId !== run.runId ||
    grant.requestCommentId !== run.requestCommentId ||
    grant.mainSha !== run.mainSha ||
    grant.candidateSha !== run.candidateSha ||
    grant.stagingCostApproved !== true ||
    grant.runAuthorized !== true ||
    grant.writeAuthorized !== true ||
    grant.productionMutationApproved !== false ||
    grant.protectedEnvironmentVerified !== true ||
    claim?.status !== 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION' ||
    claim.runId !== run.runId ||
    claim.requestCommentId !== run.requestCommentId ||
    !ID.test(claim.claimCommentId ?? '') ||
    evidence?.status !== 'INDEPENDENT_CLEANUP_WATCHDOG_LIVE' ||
    evidence.mainSha !== run.mainSha ||
    evidence.workloadIndependentOfBrowser !== true ||
    evidence.cleanupEnvironmentProtected !== true ||
    evidence.scheduleEnabledVerified !== true ||
    !Number.isSafeInteger(evidence.maxMinutes) ||
    evidence.maxMinutes < 1 || evidence.maxMinutes > 120 ||
    !Number.isSafeInteger(evidence.graceMinutes) ||
    evidence.graceMinutes < 1 || evidence.graceMinutes > 15 ||
    !Number.isSafeInteger(evidence.observedAt) ||
    now < evidence.observedAt || now - evidence.observedAt > 300000
  ) deny();
}
// Trusted main must independently authenticate live GitHub OWNER approvals.
// This adapter checks the supplied grant and records a verifiable cleanup
// contract BEFORE resource creation. It never mints that grant.
export async function registerCommunityWatchBeforeProvisioning({
  run,
  grant,
  claim,
  watchdogEvidence,
  signingKey,
  githubToken,
  supabaseToken,
  now = Date.now(),
  fetchImpl = fetch
}) {
  validate(grant, run, claim, watchdogEvidence, now);
  if ([signingKey, githubToken, supabaseToken].some(
    (item) => typeof item !== 'string' || item.length < 32
  )) deny();
  const branchName = 'community-hosted-' + run.runId;
  const inventory = await requestJson(
    fetchImpl,
    SUPABASE + PARENT + '/branches',
    supabaseToken
  );
  if (
    !Array.isArray(inventory) ||
    inventory.some((branch) => branch.name === branchName)
  ) deny();
  const start = new Date(now).toISOString();
  const end = new Date(
    now + watchdogEvidence.maxMinutes * 60000
  ).toISOString();
  const signed = signCommunityWatchIntent({
    version: 1,
    repository: REPO,
    scope: run.scope,
    runId: run.runId,
    requestCommentId: run.requestCommentId,
    mainSha: run.mainSha,
    candidateSha: run.candidateSha,
    preparedAt: start,
    expiresAt: end,
    graceMinutes: watchdogEvidence.graceMinutes
  }, signingKey);
  // A second approval ledger read is needed before the single POST.
  let seen = 0;
  for (let page = 1; page <= 30; page += 1) {
    const comments = await requestJson(
      fetchImpl,
      API + '/issues/188/comments?per_page=100&page=' + page,
      githubToken
    );
    if (!Array.isArray(comments) || comments.length > 100) deny();
    for (const comment of comments) {
      const previous = verifyCommunityWatchIntent(
        comment?.body,
        signingKey
      );
      if (previous?.runId === run.runId) seen += 1;
    }
    if (comments.length < 100) break;
    if (page === 30) deny();
  }
  if (seen !== 0) deny();
  const posted = await requestJson(
    fetchImpl,
    API + '/issues/188/comments',
    githubToken,
    'POST',
    { body: signed }
  );
  if (!Number.isSafeInteger(posted?.id) || posted.id <= 0 ||
      posted.body !== signed) deny();
  const readBack = await requestJson(
    fetchImpl,
    API + '/issues/comments/' + posted.id,
    githubToken
  );
  const checked = verifyCommunityWatchIntent(
    readBack?.body,
    signingKey
  );
  if (
    readBack?.id !== posted.id ||
    readBack.body !== signed ||
    checked?.runId !== run.runId ||
    checked?.requestCommentId !== run.requestCommentId ||
    checked.mainSha !== run.mainSha ||
    checked.candidateSha !== run.candidateSha
  ) deny();
  return Object.freeze({
    ...run,
    status: 'CLEANUP_WATCH_REGISTERED_NO_PROVISION',
    claimCommentId: claim.claimCommentId,
    registrationCommentId: String(posted.id),
    signatureReadBackVerified: true,
    providerBranchAbsentAtRegistration: true,
    independentWatchdogReadyVerified: true,
    runAuthorized: false,
    mayCreateBranch: false
  });
}
