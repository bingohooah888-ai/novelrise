// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import { readFileSync } from 'node:fs';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { URL } from 'node:url';

// prettier-ignore
import {
  inspect020705WorkflowAdmission
} from '../.github/staging-ai-02-07-05/offline-workflow-admission.mjs';

// prettier-ignore
const NOW = Date.parse('2026-11-01T08:00:00Z');
// prettier-ignore
const SHA = 'a'.repeat(40);
// prettier-ignore
const ID = 7123;
// prettier-ignore
const PREVIEW = 'dpl_synthetic123';
// prettier-ignore
function signedApproval() {
  return [{
    id: ID,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
      JSON.stringify({
        actorId: '11111111-1111-4111-8111-111111111111',
        approvalScope: 'synthetic-one-provider-one-call-only',
        capMicros: 10000000,
        confirmation: 'STAGING PAID 1 CALL APPROVED',
        consentRevision: 'test-policy-v1',
        episodeId: 11,
        expiresAt: new Date(NOW + 3600000).toISOString(),
        mainSha: SHA,
        model: 'gpt-5.6-luna',
        novelId: 41,
        previewDeploymentId: PREVIEW,
        provider: 'openai',
        stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
      })
  }];
}
// prettier-ignore
function args() {
  return {
    actor: 'bingohooah888-ai',
    triggeringActor: 'bingohooah888-ai',
    mainSha: SHA,
    expectedMainSha: SHA,
    previewDeploymentId: PREVIEW,
    approvalCommentId: ID,
    comments: signedApproval(),
    now: NOW
  };
}

// prettier-ignore
test('OWNER exact SHA can only reach read-only offline admission', async () => {
  const r = await inspect020705WorkflowAdmission(args());
  assert.equal(r.state, 'OFFLINE_PREFLIGHT_ONLY');
  assert.equal(r.allowedToExecute, false);
  assert.equal(r.allowedToClaim, false);
  assert.equal(r.allowedToUseSecrets, false);
});

// prettier-ignore
test('non-owner, drift, replay, wrong Preview and expired scope fail', async () => {
  const mutations = [
    { actor: 'other-user' },
    { triggeringActor: 'github-actions[bot]' },
    { expectedMainSha: 'b'.repeat(40) },
    { previewDeploymentId: 'dpl_different' },
    { approvalCommentId: 9876 },
    { now: NOW + 3600000 },
    { comments: [] }
  ];
  for (const m of mutations) {
    await assert.rejects(
      inspect020705WorkflowAdmission({ ...args(), ...m }),
      /AI_020705_STAGE_PREFLIGHT_DENIED/u
    );
  }
});

// prettier-ignore
test('the Staging workflow never has a live execution job or secret access', () => {
  const yaml = readFileSync(
    new URL(
      '../.github/workflows/ai-020705-owner-staging-paid-trial.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(yaml, /workflow_dispatch:/u);
  assert.match(yaml, /cancel-in-progress: false/u);
  assert.match(yaml, /github.actor == 'bingohooah888-ai'/u);
  assert.match(yaml, /ref: main/u);
  assert.match(yaml, /OFFLINE_PREFLIGHT_ONLY|OFFLINE preflight only/u);
  assert.doesNotMatch(yaml, /secrets\./u);
  assert.doesNotMatch(yaml, /issue_comment:/u);
  assert.doesNotMatch(yaml, /environment: staging/u);
  assert.doesNotMatch(yaml, /node .*paid-trial-cleanup-runner/u);
});
