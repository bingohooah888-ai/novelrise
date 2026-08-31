import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DECISIVE_JOB,
  VERIFICATION_WORKFLOW,
  evaluateProductionAuthSmokeEvidence
} from '../scripts/evaluate-production-auth-smoke-evidence.mjs';

const sha = 'a'.repeat(40);
const runId = 123456789;

function run(overrides = {}) {
  return {
    id: runId,
    name: VERIFICATION_WORKFLOW,
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: sha,
    ...overrides
  };
}

function jobs(conclusion = 'success') {
  return {
    jobs: [{ name: DECISIVE_JOB, conclusion }]
  };
}

function consumed(overrides = {}) {
  const payload = {
    requestId: `auth-smoke-${sha}-998877`,
    mainSha: sha,
    runId: String(runId),
    result: 'success',
    ...overrides
  };
  return {
    user: { login: 'github-actions[bot]' },
    body: `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED ${JSON.stringify(payload)}`
  };
}

function evaluate(overrides = {}) {
  return evaluateProductionAuthSmokeEvidence({
    run: run(),
    jobs: jobs(),
    comments: [consumed()],
    expectedHeadSha: sha,
    ...overrides
  });
}

test('real successful verification with consumed approval is PASS', () => {
  const result = evaluate();
  assert.equal(result.pass, true);
  assert.equal(result.headSha, sha);
  assert.equal(result.runId, String(runId));
});

test('request-only workflow can never be PASS evidence', () => {
  const result = evaluate({
    run: run({ name: 'NOVELIGHT Production Auth Smoke Approval Request' })
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /unexpected workflow/);
});

test('top-level success with skipped decisive job is rejected', () => {
  const result = evaluate({ jobs: jobs('skipped') });
  assert.equal(result.pass, false);
  assert.match(result.reason, /decisive verification job conclusion is skipped/);
});

test('top-level success with missing decisive job is rejected', () => {
  const result = evaluate({ jobs: { jobs: [] } });
  assert.equal(result.pass, false);
  assert.match(result.reason, /exactly one decisive verification job/);
});

test('failed verification is rejected', () => {
  const result = evaluate({ run: run({ conclusion: 'failure' }) });
  assert.equal(result.pass, false);
  assert.match(result.reason, /workflow conclusion is failure/);
});

test('unapproved or expired request without consumed ledger is rejected', () => {
  const result = evaluate({ comments: [] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /matching successful approval-consumption ledger record/);
});

test('failed approval-consumption ledger is rejected', () => {
  const result = evaluate({ comments: [consumed({ result: 'failure' })] });
  assert.equal(result.pass, false);
});

test('consumed ledger must match verification run ID', () => {
  const result = evaluate({ comments: [consumed({ runId: '999' })] });
  assert.equal(result.pass, false);
});

test('consumed ledger must match exact verification head SHA', () => {
  const result = evaluate({ comments: [consumed({ mainSha: 'b'.repeat(40) })] });
  assert.equal(result.pass, false);
});

test('required release SHA must match verification head SHA', () => {
  const result = evaluate({ expectedHeadSha: 'b'.repeat(40) });
  assert.equal(result.pass, false);
  assert.match(result.reason, /required release SHA/);
});

test('consumed ledger must be authored by GitHub Actions', () => {
  const comment = consumed();
  comment.user.login = 'someone-else';
  const result = evaluate({ comments: [comment] });
  assert.equal(result.pass, false);
});

test('bounded approval issue comment contract fails closed', () => {
  const result = evaluate({ comments: Array.from({ length: 100 }, () => consumed()) });
  assert.equal(result.pass, false);
  assert.match(result.reason, /bounded comment contract/);
});
