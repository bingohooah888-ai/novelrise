// Fail-closed trusted-main and OWNER preflight for the Community Hosted run.
// Reads authenticated GitHub Actions event context and the existing GitHub
// read-only snapshots. This module is NOT an approval, CLAIM writer or grant.
import { readFileSync } from 'node:fs';
import {
  prepareCommunityHostedClaimMarker
} from './community-hosted-claim-consume-plan.mjs';
import {
  inspectCommunityHostedReservationProtection
} from './community-hosted-reservation-protection.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const WORKFLOW =
  REPO +
  '/.github/workflows/community-hosted-precost-inspection.yml@refs/heads/main';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_TRUSTED_PREFLIGHT_DENIED: ' + reason);
}

function requireTrustedContext(context, main, event) {
  const liveMain = main?.object?.sha;
  if (
    context?.repository !== REPO ||
    context.workflowRef !== WORKFLOW ||
    context.eventName !== 'issue_comment' ||
    context.ref !== 'refs/heads/main' ||
    context.actor !== OWNER ||
    context.triggeringActor !== OWNER ||
    context.runAttempt !== '1' ||
    !ID.test(context.runId ?? '') ||
    !SHA.test(liveMain ?? '') ||
    context.eventSha !== liveMain ||
    context.checkoutSha !== liveMain ||
    event?.action !== 'created' ||
    event.repository?.full_name !== REPO ||
    event.sender?.login !== OWNER ||
    event.comment?.user?.login !== OWNER
  ) {
    deny('untrusted workflow context, OWNER or checked-out revision');
  }
}

// All conditions are ANDed. An unprotected one-use tag, replay attempt,
// HEAD drift, forged actor or mismatched Draft candidate permanently denies.
// A successful inspection is only a read-only proposal, NEVER permission
// to create a Git ref, submit CLAIM, use Staging or start a browser.
export function inspectCommunityHostedTrustedRunner({
  context,
  event,
  main,
  feature,
  ledgerPages,
  inventoryPages,
  tagRuleDetails
}) {
  requireTrustedContext(context, main, event);
  const proposed = prepareCommunityHostedClaimMarker({
    event,
    main,
    feature,
    ledgerPages,
    runId: context.runId
  });
  if (
    proposed.status !== 'CLAIM_MARKER_PREPARATION_ONLY' ||
    proposed.stagingCostApproved !== false ||
    proposed.runAuthorized !== false
  ) {
    deny('claim proposal attempted to grant execution');
  }

  const protection = inspectCommunityHostedReservationProtection({
    repository: REPO,
    inventoryPages,
    tagRuleDetails
  });
  if (
    protection.protectionObserved !== true ||
    protection.runAuthorized !== false ||
    protection.stagingCostApproved !== false
  ) {
    deny('reservation protection evidence not fail-closed');
  }
  return Object.freeze({
    status: 'COMMUNITY_HOSTED_TRUSTED_MAIN_READ_ONLY_PRECHECK',
    mainSha: proposed.mainSha,
    candidateSha: proposed.candidateSha,
    requestCommentId: proposed.requestCommentId,
    runId: proposed.runId,
    observedLastCommentId: proposed.observedLastCommentId,
    reservationRulesetIds: Object.freeze([...protection.matchingRulesetIds]),
    authenticatedOwnerByThisModule: false,
    atomicClaimVerified: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'validate') {
  try {
    if (process.argv.length !== 9) {
      deny('requires exactly six JSON source files');
    }
    const file = (index) => JSON.parse(readFileSync(process.argv[index], 'utf8'));
    const result = inspectCommunityHostedTrustedRunner({
      context: {
        repository: process.env.GITHUB_REPOSITORY,
        workflowRef: process.env.GITHUB_WORKFLOW_REF,
        eventName: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF,
        eventSha: process.env.GITHUB_SHA,
        checkoutSha: process.env.HOSTED_TRUSTED_CHECKOUT_SHA,
        actor: process.env.GITHUB_ACTOR,
        triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        runId: process.env.GITHUB_RUN_ID
      },
      event: file(3),
      main: file(4),
      feature: file(5),
      ledgerPages: file(6),
      inventoryPages: file(7),
      tagRuleDetails: file(8)
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // Never echo untrusted event bodies or connector/secret-bearing errors.
    console.error('COMMUNITY_HOSTED_TRUSTED_PREFLIGHT_DENIED');
    process.exitCode = 1;
  }
}
