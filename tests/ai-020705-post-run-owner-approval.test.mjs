import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import {
  inspect020705PostRunOwnerApproval
} from '../.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs';

// prettier-ignore
const NOW = Date.parse('2026-11-16T12:30:00.000Z');
// prettier-ignore
const MAIN = 'a'.repeat(40);
// prettier-ignore
const CANDIDATE = 'b'.repeat(40);
// prettier-ignore
const BRANCH = 'staging/ai-02-07-05-owner-run-bound';
// prettier-ignore
const RUN = 12345;
// prettier-ignore
const USER = 'bingohooah888-ai';
// prettier-ignore
const intentPayload = {
  mainSha: MAIN, candidateSha: CANDIDATE,
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  pr: 2895, scope: 'read-only-protected-entry-no-live-execution'
};
// prettier-ignore
const approvalPayload = {
  actorId: '11111111-1111-4111-8111-111111111111',
  approvalScope: 'synthetic-one-provider-one-call-only',
  capMicros: 1000000,
  confirmation: 'STAGING PAID 1 CALL APPROVED',
  consentRevision: 'synthetic-policy-v1',
  episodeId: 998892072,
  expiresAt: '2026-11-16T12:50:00.000Z',
  mainSha: MAIN,
  model: 'gpt-6.1-sol',
  novelId: 998892071,
  previewDeploymentId: 'dpl_approved123',
  provider: 'openai',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  approvalIssueNumber: 294,
  candidateSha: CANDIDATE,
  repository: 'bingohooah888-ai/novelrise',
  runId: RUN,
  stagingBranch: BRANCH
};
// prettier-ignore
function owner(id, body, created_at = '2026-11-16T12:28:00.000Z') {
  return {
    id, body, created_at, updated_at: created_at,
    user: { login: USER }, author_association: 'OWNER'
  };
}
// prettier-ignore
function fixtures() {
  return [
    owner(600, 'NOVELIGHT_STAGING_AI_020705_INTEGRATION_INTENT ' +
      JSON.stringify(intentPayload), '2026-11-16T12:25:00.000Z'),
    owner(601, 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
      JSON.stringify(approvalPayload))
  ];
}
// prettier-ignore
function read(comments = fixtures(), patch = {}) {
  return inspect020705PostRunOwnerApproval({
    comments, intentCommentId: 600, runId: RUN,
    mainSha: MAIN, candidateSha: CANDIDATE,
    stagingBranch: BRANCH, now: NOW, ...patch
  });
}

// prettier-ignore
test('OWNER may approve only after the Actions run ID exists; result grants no execution', () => {
  const proof = read();
  assert.equal(proof.state, 'RUN_BOUND_OWNER_APPROVAL_READ_ONLY');
  assert.equal(proof.runId, RUN);
  assert.equal(proof.approvalCommentId, 601);
  assert.equal(proof.previewDeploymentId, 'dpl_approved123');
  assert.equal(proof.capMicros, 1000000);
  assert.equal(proof.authorizesPaidCall, false);
  assert.equal(proof.authorizesStagingWrite, false);
  assert.equal(proof.authorizesPreviewCreation, false);
});

// prettier-ignore
test('missing, duplicate, old, edited, or mismatched run approval fails closed', () => {
  const initial = fixtures();
  assert.throws(() => read(initial.slice(0, 1)), /OWNER_LEDGER_DENIED/u);
  assert.throws(() => read([...initial, { ...initial[1], id: 602 }]),
    /OWNER_LEDGER_DENIED/u);
  assert.throws(() => read([initial[0], {
    ...initial[1],
    created_at: '2026-11-16T12:20:00.000Z',
    updated_at: '2026-11-16T12:20:00.000Z'
  }]), /OWNER_LEDGER_DENIED/u);
  assert.throws(() => read([initial[0], {
    ...initial[1], updated_at: '2026-11-16T12:29:00.000Z'
  }]), /OWNER_LEDGER_DENIED/u);
  assert.throws(() => read(initial, { runId: RUN + 1 }), /OWNER_LEDGER_DENIED/u);
  assert.throws(() => read(initial, { candidateSha: 'c'.repeat(40) }),
    /OWNER_LEDGER_DENIED/u);
});

// prettier-ignore
test('approval already CLAIMED or CONSUMED is not accepted again', () => {
  for (const status of ['CLAIMED', 'CONSUMED']) {
    const marker = {
      id: 602, user: { login: 'github-actions[bot]' },
      body: 'NOVELIGHT_STAGING_AI_020705_PAID_' + status + ' ' +
        JSON.stringify({ approvalCommentId: 601, runId: RUN })
    };
    assert.throws(() => read([...fixtures(), marker]), /OWNER_LEDGER_DENIED/u);
  }
});

// prettier-ignore
test('unrelated older same-SHA approval is not a substitute for this run', () => {
  const comments = fixtures();
  const historical = owner(550, 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
    JSON.stringify({ ...approvalPayload, runId: 100 }), '2026-11-16T12:01:00.000Z');
  assert.equal(read([historical, ...comments]).approvalCommentId, 601);
});

// prettier-ignore
test('amount above the single dollar cap or stale expiry is refused', () => {
  const comments = fixtures();
  const paid = (value) => owner(601,
    'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' + JSON.stringify(value));
  assert.throws(() =>
    read([comments[0], paid({ ...approvalPayload, capMicros: 1000001 })]),
    /OWNER_LEDGER_DENIED/u);
  assert.throws(() =>
    read([comments[0], paid({
      ...approvalPayload, expiresAt: '2026-11-16T12:29:59.000Z'
    })]), /OWNER_LEDGER_DENIED/u);
});
