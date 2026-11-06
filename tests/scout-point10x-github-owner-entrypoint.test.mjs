import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  executeOwnerReadOnlyPreflight,
  validateTrustedMainEvent
} from '../scripts/scout-point10x-github-owner-entrypoint.mjs';
import { OWNER_MARKER } from '../scripts/scout-point10x-owner-readonly-evidence.mjs';

const sha = 'a'.repeat(40);
const id = 317436651;
const body = OWNER_MARKER + '\n{}';
const validEvent = () => ({
  action: 'created',
  repository: {
    full_name: 'bingohooah888-ai/novelrise',
    default_branch: 'main',
    owner: { id }
  },
  issue: { number: 294 },
  sender: { id, login: 'bingohooah888-ai' },
  comment: {
    id: 7245311,
    user: { id, login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    created_at: '2026-11-06T10:00:00Z',
    updated_at: '2026-11-06T10:00:00Z',
    body
  }
});
const validEnv = () => ({
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  GITHUB_EVENT_NAME: 'issue_comment',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF:
    'bingohooah888-ai/novelrise/.github/workflows/scout-point10x-readonly.yml@refs/heads/main',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
  GITHUB_ACTOR_ID: String(id),
  GITHUB_SHA: sha,
  GITHUB_EVENT_PATH: 'synthetic-fixture-only',
  GITHUB_TOKEN: 'NOT_A_REAL_TOKEN_TEST_ONLY'
});

test('valid created OWNER event is still an identity candidate, not authorization', () => {
  const result = validateTrustedMainEvent(validEvent(), validEnv(), sha);
  assert.equal(result.commentId, 7245311);
  assert.equal(result.rerun, false);
  assert.equal(Object.hasOwn(result, 'mayConnectStaging'), false);
});

const invalid = [
  ['wrong repo', (e) => { e.repository.full_name = 'attacker/repo'; }],
  ['wrong owner ID', (e) => { e.sender.id = 11; }],
  ['false author claim', (e) => { e.comment.author_association = 'NONE'; }],
  ['edited comment', (e) => { e.comment.updated_at = '2026-11-06T10:01:00Z'; }],
  ['wrong issue', (e) => { e.issue.number = 10; }],
  ['pr comment', (e) => { e.issue.pull_request = { url: 'x' }; }],
  ['comment changed', (e) => { e.comment.body = 'some other text'; }],
  ['edited event', (e) => { e.action = 'edited'; }],
  ['sender is different', (e) => { e.comment.user.id = 11; }],
];
for (const [name, change] of invalid) {
  test('reject event: ' + name, () => {
    const e = validEvent();
    change(e);
    assert.throws(
      () => validateTrustedMainEvent(e, validEnv(), sha),
      /POINT10X_EVENT_HOLD:/
    );
  });
}
const invalidEnvs = [
  ['rerun', (e) => { e.GITHUB_RUN_ATTEMPT = '2'; }],
  ['wrong ref', (e) => { e.GITHUB_REF = 'refs/heads/feature/evil'; }],
  ['wrong SHA', (e) => { e.GITHUB_SHA = 'c'.repeat(40); }],
  ['untrusted workflow', (e) => { e.GITHUB_WORKFLOW_REF = 'another.yml'; }],
  ['wrong actor', (e) => { e.GITHUB_ACTOR_ID = '1'; }],
  ['rerun by other actor', (e) => { e.GITHUB_TRIGGERING_ACTOR = 'someone'; }]
];
for (const [name, change] of invalidEnvs) {
  test('reject execution environment: ' + name, () => {
    const env = validEnv();
    change(env);
    assert.throws(
      () => validateTrustedMainEvent(validEvent(), env, sha),
      /POINT10X_EVENT_HOLD:/
    );
  });
}
test('reject a checkout on a different revision', () => {
  assert.throws(
    () => validateTrustedMainEvent(validEvent(), validEnv(), 'b'.repeat(40)),
    /UNTRUSTED_RUN_IDENTITY/
  );
});

const sampleFacts = () => ({
  issue: { number: 294 }
});
test('reject before GitHub API if event is forged', async () => {
  let called = false;
  const e = validEvent();
  e.sender.id = 2;
  await assert.rejects(
    executeOwnerReadOnlyPreflight({
      env: validEnv(),
      readEvent: async () => JSON.stringify(e),
      checkoutSha: () => sha,
      collectFacts: async () => {
        called = true;
        return sampleFacts();
      }
    }),
    /UNTRUSTED_OWNER_EVENT/
  );
  assert.equal(called, false);
});
test('real collector entrance does not authorize Staging even with valid-looking fake verdict', async () => {
  let sawToken = false;
  const verdict = await executeOwnerReadOnlyPreflight({
    env: validEnv(),
    readEvent: async () => JSON.stringify(validEvent()),
    checkoutSha: () => sha,
    collectFacts: async ({ token, commentId }) => {
      sawToken = token === validEnv().GITHUB_TOKEN && commentId === 7245311;
      return sampleFacts();
    },
    verifyFacts: ({ trigger }) => ({
      status: 'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY',
      commentId: trigger.commentId,
      freshMain: sha,
      ownerAuthenticatedForExecution: false,
      controlSpentConsumed: false,
      mayConnectStaging: false
    })
  });
  assert.equal(sawToken, true);
  assert.equal(verdict.status, 'NO_GO_OWNER_FACTS_READ_ONLY');
  assert.equal(verdict.mayConnectStaging, false);
  assert.equal(verdict.liveAuthorized, false);
});
test('fake positive verifier can never authorize staging or CONTROL', async () => {
  await assert.rejects(
    executeOwnerReadOnlyPreflight({
      env: validEnv(),
      readEvent: async () => JSON.stringify(validEvent()),
      checkoutSha: () => sha,
      collectFacts: async () => sampleFacts(),
      verifyFacts: () => ({
        status: 'GO_LIVE',
        mayConnectStaging: true,
        controlSpentConsumed: true
      })
    }),
    /EVIDENCE_VERDICT_UNTRUSTED/
  );
});
test('no token or supplied event body is ever used as a logger input', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/scout-point10x-readonly.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /issue_comment:/u);
  assert.match(workflow, /types: \[created\]/u);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /STAGING_DATABASE_URL|CONTROL_DATABASE_URL/u);
});
