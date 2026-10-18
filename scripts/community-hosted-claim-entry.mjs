// OWNER-authenticated GitHub Actions entry for the Community hosted CLAIM record.
// This records one immutable Git tag + one ledger CLAIM ONLY. It does not grant
// Staging cost, launch a Preview/browser or run any Supabase operation.
// Available as CLI solely in the exact trusted main workflow named below.
import { readFileSync } from 'node:fs';

import { makeCommunityHostedGitHubAdapter } from './community-hosted-github-adapter.mjs';
import { reserveAndRecordCommunityHostedClaim } from './community-hosted-reservation-coordinator.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const WORKFLOW_REF =
  REPO + '/.github/workflows/community-hosted-executor.yml@refs/heads/main';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const ISSUE_TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const MARKER = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny() {
  // No raw event payload, API response, actor-supplied body, or tokens in errors.
  throw new Error('COMMUNITY_HOSTED_CLAIM_ENTRY_DENIED');
}

// The OWNER's original signed-by-GitHub event is bound to fresh API reads.
// Event delivery and API snapshots are independently checked before any writes.
// The coordinator separately refreshes main, PR, ledger and tag rules.
export function inspectCommunityHostedClaimEntry({
  environment,
  event,
  issue,
  comment,
  checkedOutSha
}) {
  if (
    environment?.GITHUB_ACTIONS !== 'true' ||
    environment.GITHUB_EVENT_NAME !== 'issue_comment' ||
    environment.GITHUB_REPOSITORY !== REPO ||
    environment.GITHUB_REF !== 'refs/heads/main' ||
    environment.GITHUB_WORKFLOW_REF !== WORKFLOW_REF ||
    environment.GITHUB_ACTOR !== OWNER ||
    environment.GITHUB_TRIGGERING_ACTOR !== OWNER ||
    !ID.test(String(environment.GITHUB_RUN_ID ?? '')) ||
    !SHA.test(checkedOutSha ?? '') ||
    environment.GITHUB_SHA !== checkedOutSha ||
    event?.action !== 'created' ||
    event.repository?.full_name !== REPO ||
    event.issue?.number !== 188 ||
    event.issue?.id !== issue?.id ||
    event.issue?.title !== ISSUE_TITLE ||
    event.issue?.user?.login !== OWNER ||
    event.issue?.pull_request ||
    issue?.number !== 188 ||
    issue.title !== ISSUE_TITLE ||
    issue.user?.login !== OWNER ||
    issue.pull_request ||
    issue.url !== ISSUE_URL ||
    event.comment?.id !== comment?.id ||
    !Number.isSafeInteger(event.comment?.id) ||
    event.comment.id < 1 ||
    event.comment.user?.login !== OWNER ||
    comment.user?.login !== OWNER ||
    event.comment.author_association !== 'OWNER' ||
    comment.author_association !== 'OWNER' ||
    !comment.issue_url ||
    comment.issue_url !== ISSUE_URL ||
    event.comment.body !== comment.body ||
    typeof comment.body !== 'string' ||
    !comment.body.startsWith(MARKER) ||
    event.comment.created_at !== comment.created_at ||
    event.comment.updated_at !== comment.updated_at
  ) {
    deny();
  }
  return Object.freeze({
    repository: REPO,
    trustedMainSha: checkedOutSha,
    requestCommentId: String(comment.id),
    runId: String(environment.GITHUB_RUN_ID),
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

// This is not a privileged execution-grant generator. Even a persisted CLAIM
// has no right to spend money, create a DB branch, deploy or use credentials.
export async function recordCommunityHostedOwnerClaim({
  environment,
  event,
  issue,
  comment,
  checkedOutSha,
  actions
}) {
  const context = inspectCommunityHostedClaimEntry({
    environment,
    event,
    issue,
    comment,
    checkedOutSha
  });
  const receipt = await reserveAndRecordCommunityHostedClaim({
    repository: context.repository,
    trustedMainSha: context.trustedMainSha,
    event,
    runId: context.runId,
    actions
  });
  if (
    receipt.status !== 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION' ||
    receipt.runId !== context.runId ||
    receipt.requestCommentId !== context.requestCommentId ||
    receipt.stagingCostApproved !== false ||
    receipt.runAuthorized !== false ||
    receipt.writeAuthorized !== false ||
    receipt.releaseAuthorized !== false ||
    receipt.executableGrantIssued !== false
  ) {
    deny();
  }
  return Object.freeze({
    status: 'COMMUNITY_HOSTED_OWNER_CLAIM_RECORDED_NO_EXECUTION',
    requestCommentId: context.requestCommentId,
    runId: context.runId,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'claim') {
  try {
    if (
      process.argv.length !== 6 ||
      !process.env.GITHUB_EVENT_PATH ||
      !process.env.GH_TOKEN
    ) {
      deny();
    }
    const [, , , issuePath, commentPath, checkedOutSha] = process.argv;
    const parse = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const event = parse(process.env.GITHUB_EVENT_PATH);
    const issue = parse(issuePath);
    const comment = parse(commentPath);
    // Context gate before constructing the write-capable transport.
    inspectCommunityHostedClaimEntry({
      environment: process.env,
      event,
      issue,
      comment,
      checkedOutSha
    });
    const actions = makeCommunityHostedGitHubAdapter({
      token: process.env.GH_TOKEN
    });
    const verdict = await recordCommunityHostedOwnerClaim({
      environment: process.env,
      event,
      issue,
      comment,
      checkedOutSha,
      actions
    });
    process.stdout.write(JSON.stringify(verdict) + '\n');
  } catch {
    console.error('COMMUNITY_HOSTED_CLAIM_ENTRY_DENIED');
    process.exitCode = 1;
  }
}
