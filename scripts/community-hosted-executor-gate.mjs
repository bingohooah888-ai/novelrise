// A read-only trusted-main OWNER entry. Never claims an approval or creates resources.
import { readFileSync } from 'node:fs';
import { inspectCommunityHostedClaimEntry } from './community-hosted-claim-entry.mjs';
import { verifyCommunityHostedPreCostAdmission } from './community-hosted-precost-admission.mjs';

function deny() {
  throw new Error('COMMUNITY_HOSTED_EXECUTOR_PRECLAIM_DENIED');
}

export function inspectCommunityHostedExecutorPreclaim({
  environment, event, issue, comment, main, feature, ledgerPages, checkedOutSha
}) {
  const owner = inspectCommunityHostedClaimEntry({
    environment, event, issue, comment, checkedOutSha
  });
  if (main?.object?.sha !== checkedOutSha || !Array.isArray(ledgerPages)) deny();
  let proposal;
  try {
    proposal = verifyCommunityHostedPreCostAdmission({
      event, main, feature, ledgerPages, runId: owner.runId
    });
  } catch {
    deny();
  }
  if (
    proposal.status !== 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY' ||
    proposal.mainSha !== owner.trustedMainSha ||
    proposal.requestCommentId !== owner.requestCommentId ||
    proposal.runId !== owner.runId ||
    proposal.stagingCostApproved !== false ||
    proposal.runAuthorized !== false ||
    proposal.mayClaim !== false
  ) deny();
  return Object.freeze({
    status: 'COMMUNITY_HOSTED_EXECUTOR_PRECLAIM_READONLY_ONLY',
    trustedMainSha: owner.trustedMainSha,
    candidateSha: proposal.candidateSha,
    requestCommentId: owner.requestCommentId,
    runId: owner.runId,
    ownerEvidenceVerified: true,
    exactApprovalSnapshotVerified: true,
    claimAuthorized: false,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false
  });
}

if (process.argv[2] === 'inspect') {
  try {
    const args = process.argv.slice(3);
    if (args.length !== 6 || !process.env.GITHUB_EVENT_PATH) deny();
    const [issuePath, commentPath, mainPath, featurePath, ledgerPath, checkedOutSha] = args;
    const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const decision = inspectCommunityHostedExecutorPreclaim({
      environment: process.env,
      event: read(process.env.GITHUB_EVENT_PATH),
      issue: read(issuePath), comment: read(commentPath),
      main: read(mainPath), feature: read(featurePath),
      ledgerPages: read(ledgerPath), checkedOutSha
    });
    process.stdout.write(JSON.stringify(decision) + '\n');
  } catch {
    console.error('COMMUNITY_HOSTED_EXECUTOR_PRECLAIM_DENIED');
    process.exitCode = 1;
  }
}
