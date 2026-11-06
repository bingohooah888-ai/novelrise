// Trusted-main GitHub OWNER event intake. READ-ONLY preflight only.
// No CONTROL CAS, Staging/Production connection, approval claim or live switch.
// Future live execution is intentionally impossible from this entrypoint.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  GITHUB_OWNER_ID,
  GITHUB_OWNER_LOGIN,
  GITHUB_REPO,
  ISSUE_NUMBER,
  OWNER_MARKER,
  collectGitHubOwnerEvidenceReadOnly,
  inspectFreshGitHubOwnerEvidence
} from './scout-point10x-owner-readonly-evidence.mjs';

const WORKFLOW_REF =
  GITHUB_REPO + '/.github/workflows/scout-point10x-readonly.yml@refs/heads/main';
const hex40 = (value) =>
  typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const deny = (reason) => {
  throw new Error('POINT10X_EVENT_HOLD:' + reason);
};

// The workflow event is a candidate, not an OWNER grant. All authoritative
// resource snapshots are separately re-fetched via GitHub's official REST API.
export function validateTrustedMainEvent(event, env, checkedOutSha) {
  if (!object(event) || !object(env)) deny('MISSING_EVENT_OR_ENV');
  if (
    env.GITHUB_REPOSITORY !== GITHUB_REPO ||
    env.GITHUB_EVENT_NAME !== 'issue_comment' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    env.GITHUB_ACTOR !== GITHUB_OWNER_LOGIN ||
    env.GITHUB_TRIGGERING_ACTOR !== GITHUB_OWNER_LOGIN ||
    env.GITHUB_ACTOR_ID !== String(GITHUB_OWNER_ID) ||
    !hex40(env.GITHUB_SHA) ||
    checkedOutSha !== env.GITHUB_SHA
  )
    deny('UNTRUSTED_RUN_IDENTITY');
  if (
    event.action !== 'created' ||
    !object(event.repository) ||
    event.repository.full_name !== GITHUB_REPO ||
    event.repository.default_branch !== 'main' ||
    event.repository.owner?.id !== GITHUB_OWNER_ID ||
    !object(event.issue) ||
    event.issue.number !== ISSUE_NUMBER ||
    event.issue.pull_request != null ||
    !object(event.comment) ||
    !Number.isSafeInteger(event.comment.id) ||
    event.comment.id <= 0 ||
    event.comment.user?.id !== GITHUB_OWNER_ID ||
    event.comment.user?.login !== GITHUB_OWNER_LOGIN ||
    event.comment.author_association !== 'OWNER' ||
    event.comment.created_at !== event.comment.updated_at ||
    typeof event.comment.body !== 'string' ||
    !event.comment.body.startsWith(OWNER_MARKER + '\n') ||
    event.sender?.id !== GITHUB_OWNER_ID ||
    event.sender?.login !== GITHUB_OWNER_LOGIN
  )
    deny('UNTRUSTED_OWNER_EVENT');
  return Object.freeze({
    commentId: event.comment.id,
    runSha: env.GITHUB_SHA,
    action: 'created',
    eventName: 'issue_comment',
    actorId: GITHUB_OWNER_ID,
    actorLogin: GITHUB_OWNER_LOGIN,
    issueNumber: ISSUE_NUMBER,
    repository: GITHUB_REPO,
    rerun: false
  });
}

// The only real I/O in this module is read-only GitHub REST. Dependencies
// are injectable for offline negative tests, not for runtime permission grants.
export async function executeOwnerReadOnlyPreflight({
  env = process.env,
  readEvent = () => readFile(env.GITHUB_EVENT_PATH, 'utf8'),
  checkoutSha = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true
    }).trim(),
  collectFacts = collectGitHubOwnerEvidenceReadOnly,
  verifyFacts = inspectFreshGitHubOwnerEvidence
} = {}) {
  if (
    typeof env.GITHUB_EVENT_PATH !== 'string' ||
    env.GITHUB_EVENT_PATH.length === 0
  )
    deny('EVENT_PATH_REQUIRED');
  let event;
  try {
    event = JSON.parse(await readEvent());
  } catch {
    deny('EVENT_JSON_INVALID');
  }
  const trigger = validateTrustedMainEvent(event, env, checkoutSha());
  if (typeof env.GITHUB_TOKEN !== 'string' || env.GITHUB_TOKEN.length < 12)
    deny('EPHEMERAL_GITHUB_TOKEN_REQUIRED');
  const facts = await collectFacts({
    token: env.GITHUB_TOKEN,
    commentId: trigger.commentId
  });
  const verdict = verifyFacts({
    ...facts,
    trigger,
    now: new Date().toISOString()
  });
  if (
    !object(verdict) ||
    verdict.status !== 'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY' ||
    verdict.commentId !== trigger.commentId ||
    verdict.freshMain !== trigger.runSha ||
    verdict.ownerAuthenticatedForExecution !== false ||
    verdict.controlSpentConsumed !== false ||
    verdict.mayConnectStaging !== false
  )
    deny('EVIDENCE_VERDICT_UNTRUSTED');
  // Always HOLD even with genuine GitHub facts. CONTROL, Staging role and
  // independent auditor must be connected and approved separately.
  return Object.freeze({
    status: 'NO_GO_OWNER_FACTS_READ_ONLY',
    mainSha: trigger.runSha,
    controlSpentConsumed: false,
    mayConnectStaging: false,
    liveAuthorized: false
  });
}

async function main() {
  try {
    const result = await executeOwnerReadOnlyPreflight();
    process.stdout.write(result.status + '\n');
  } catch (error) {
    // Never log exception objects, response payloads, owner comment contents
    // or any credential. Only bounded hardcoded classifications.
    const reason =
      typeof error?.message === 'string' &&
      /^POINT10X_(?:EVENT|OWNER)_HOLD:[A-Z0-9_]{2,70}$/u.test(error.message)
        ? error.message
        : 'POINT10X_EVENT_HOLD:UNCLASSIFIED';
    process.stderr.write(reason + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
