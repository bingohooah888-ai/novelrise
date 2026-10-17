import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';
import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedPreCostAdmission
} from '../scripts/community-hosted-precost-admission.mjs';
import {
  inspectCommunityHostedClaimReceipt,
  inspectCommunityHostedConsumeReceipt,
  prepareCommunityHostedClaimMarker,
  prepareCommunityHostedConsumeMarker
} from '../scripts/community-hosted-claim-consume-plan.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const RUN = '456';
const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';

function fixture() {
  const event = {
    action: 'created',
    repository: { full_name: REPO },
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: OWNER }
    },
    comment: {
      id: 123,
      user: { login: OWNER },
      author_association: 'OWNER',
      body:
        HOSTED_PRE_COST_APPROVE +
        JSON.stringify({
          scope: HOSTED_SCOPE,
          mainSha: MAIN,
          featureSha: FEATURE,
          target: 'new-data-less-isolated-branch',
          confirmation: 'STAGING COST APPROVED'
        })
    }
  };
  const main = { object: { sha: MAIN } };
  const feature = {
    number: 2222,
    state: 'open',
    draft: true,
    merged: false,
    base: { ref: 'main' },
    head: { sha: FEATURE, repo: { full_name: REPO } }
  };
  const ledgerPages = [[event.comment]];
  const preparation = verifyCommunityHostedPreCostAdmission({
    event,
    main,
    feature,
    ledgerPages,
    runId: RUN
  });
  return { event, main, feature, ledgerPages, preparation };
}

function record(id, prefix, changes = {}) {
  return {
    id,
    user: { login: 'github-actions[bot]' },
    body:
      prefix +
      JSON.stringify({
        requestCommentId: '123',
        mainSha: MAIN,
        featureSha: FEATURE,
        runId: RUN,
        ...(prefix === HOSTED_CONSUMED ? { result: 'failure' } : {}),
        ...changes
      })
  };
}

function claimed() {
  const input = fixture();
  input.ledgerPages[0].push(record(124, HOSTED_CLAIMED));
  return input;
}

function consumed(outcome = 'failure') {
  const input = claimed();
  input.ledgerPages[0].push(
    record(125, HOSTED_CONSUMED, { result: outcome })
  );
  return input;
}

const finish = (input, options = {}) =>
  prepareCommunityHostedConsumeMarker({
    event: input.event,
    preparation: input.preparation,
    ledgerPages: input.ledgerPages,
    outcome: 'failure',
    freshMainSha: MAIN,
    freshCandidateSha: FEATURE,
    ...options
  });

const validLifecycle = () => ({
  status: 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED',
  browserVerified: true,
  cleanupVerified: true,
  mainSha: MAIN,
  candidateSha: FEATURE,
  requestCommentId: '123',
  runId: RUN
});

test('claim marker is deterministic, frozen and never authorizes a write', () => {
  const x = fixture();
  const result = prepareCommunityHostedClaimMarker({
    event: x.event,
    main: x.main,
    feature: x.feature,
    ledgerPages: x.ledgerPages,
    runId: RUN
  });
  assert.equal(result.status, 'CLAIM_MARKER_PREPARATION_ONLY');
  assert.equal(result.observedLastCommentId, '123');
  assert.equal(result.observationIsNotAtomic, true);
  assert.deepEqual(JSON.parse(result.body.slice(HOSTED_CLAIMED.length)), {
    requestCommentId: '123',
    mainSha: MAIN,
    featureSha: FEATURE,
    runId: RUN
  });
  for (const flag of [
    'ownerAuthenticatedByThisModule',
    'atomicClaimVerified',
    'stagingCostApproved',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(result[flag], false, flag);
  }
  assert.ok(Object.isFrozen(result));
});

test('fresh claim proposal rejects previously claimed or consumed requests', () => {
  for (const state of [claimed(), consumed()]) {
    assert.throws(
      () =>
        prepareCommunityHostedClaimMarker({
          event: state.event,
          main: state.main,
          feature: state.feature,
          ledgerPages: state.ledgerPages,
          runId: RUN
        }),
      /DENIED/u
    );
  }
});

test('fresh claim proposal rejects main drift or missing OWNER source', () => {
  const x = fixture();
  x.main.object.sha = 'b'.repeat(40);
  assert.throws(
    () =>
      prepareCommunityHostedClaimMarker({
        event: x.event,
        main: x.main,
        feature: x.feature,
        ledgerPages: x.ledgerPages,
        runId: RUN
      }),
    /DENIED/u
  );
  const other = fixture();
  other.ledgerPages = [[]];
  assert.throws(
    () =>
      prepareCommunityHostedClaimMarker({
        event: other.event,
        main: other.main,
        feature: other.feature,
        ledgerPages: other.ledgerPages,
        runId: RUN
      }),
    /DENIED/u
  );
});

test('claim receipt requires exactly one authentic bot claim, not consume', () => {
  const x = claimed();
  const receipt = inspectCommunityHostedClaimReceipt(x);
  assert.equal(receipt.status, 'CLAIM_RECEIPT_INSPECTION_ONLY');
  assert.equal(receipt.claimCommentId, '124');
  assert.equal(receipt.runAuthorized, false);
  assert.equal(receipt.atomicClaimVerified, false);
  assert.throws(
    () => inspectCommunityHostedClaimReceipt(fixture()),
    /DENIED/u
  );
  assert.throws(
    () => inspectCommunityHostedClaimReceipt(consumed()),
    /DENIED/u
  );
  x.ledgerPages[0][1].user.login = OWNER;
  assert.throws(() => inspectCommunityHostedClaimReceipt(x), /DENIED/u);
});

test('failure and cancelled consumption require a matching recorded claim', () => {
  for (const outcome of ['failure', 'cancelled']) {
    const x = claimed();
    const proposal = finish(x, { outcome });
    assert.equal(proposal.status, 'CONSUME_MARKER_PREPARATION_ONLY');
    assert.equal(proposal.cleanupVerifiedByThisModule, false);
    assert.equal(proposal.runAuthorized, false);
    assert.equal(
      JSON.parse(proposal.body.slice(HOSTED_CONSUMED.length)).result,
      outcome
    );
  }
  assert.throws(() => finish(fixture()), /DENIED/u);
  assert.throws(() => finish(consumed()), /DENIED/u);
  assert.throws(
    () => finish(claimed(), { outcome: 'reset' }),
    /DENIED/u
  );
});

test('successful consumption demands exact run-bound cleanup proof', () => {
  const x = claimed();
  const approved = finish(x, {
    outcome: 'success',
    lifecycleProof: validLifecycle()
  });
  assert.equal(approved.outcome, 'success');
  assert.equal(approved.stagingCostApproved, false);
  assert.equal(approved.cleanupVerifiedByThisModule, false);
  for (const wrong of [
    undefined,
    { ...validLifecycle(), runId: '999' },
    { ...validLifecycle(), requestCommentId: '999' },
    { ...validLifecycle(), mainSha: 'b'.repeat(40) },
    { ...validLifecycle(), candidateSha: 'b'.repeat(40) },
    { ...validLifecycle(), browserVerified: false },
    { ...validLifecycle(), cleanupVerified: false },
    { ...validLifecycle(), status: 'PARTIAL' }
  ]) {
    assert.throws(
      () => finish(x, { outcome: 'success', lifecycleProof: wrong }),
      /DENIED/u
    );
  }
});

test('consumption rejects stale main or candidate revision', () => {
  assert.throws(
    () => finish(claimed(), { freshMainSha: 'b'.repeat(40) }),
    /DENIED/u
  );
  assert.throws(
    () => finish(claimed(), { freshCandidateSha: 'b'.repeat(40) }),
    /DENIED/u
  );
  assert.throws(
    () => finish(claimed(), { freshMainSha: undefined }),
    /DENIED/u
  );
});

test('consume receipt requires exactly one final result and no duplicate', () => {
  const x = consumed('failure');
  const receipt = inspectCommunityHostedConsumeReceipt({
    event: x.event,
    preparation: x.preparation,
    ledgerPages: x.ledgerPages,
    expectedOutcome: 'failure'
  });
  assert.equal(receipt.status, 'CONSUME_RECEIPT_INSPECTION_ONLY');
  assert.equal(receipt.claimCommentId, '124');
  assert.equal(receipt.consumeCommentId, '125');
  assert.equal(receipt.runAuthorized, false);
  assert.throws(
    () =>
      inspectCommunityHostedConsumeReceipt({
        event: x.event,
        preparation: x.preparation,
        ledgerPages: x.ledgerPages,
        expectedOutcome: 'success'
      }),
    /DENIED/u
  );
  x.ledgerPages[0].push(record(126, HOSTED_CONSUMED));
  assert.throws(
    () =>
      inspectCommunityHostedConsumeReceipt({
        event: x.event,
        preparation: x.preparation,
        ledgerPages: x.ledgerPages,
        expectedOutcome: 'failure'
      }),
    /DENIED/u
  );
});

test('claim receipt rejects mismatched run ID and revision replay', () => {
  const x = claimed();
  x.ledgerPages[0][1] = record(124, HOSTED_CLAIMED, { runId: '999' });
  assert.throws(() => inspectCommunityHostedClaimReceipt(x), /DENIED/u);
  x.ledgerPages[0][1] = record(124, HOSTED_CLAIMED, {
    mainSha: 'b'.repeat(40)
  });
  assert.throws(() => inspectCommunityHostedClaimReceipt(x), /DENIED/u);
});
