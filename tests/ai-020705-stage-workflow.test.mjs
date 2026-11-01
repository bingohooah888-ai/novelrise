import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  inspect020705WorkflowAdmission
} from '../.github/staging-ai-02-07-05/offline-workflow-admission.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const ID = 7123;
const PREVIEW = 'dpl_synthetic123';
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

test('OWNER exact SHA can only reach read-only offline admission', async () => {
  const r = await inspect020705WorkflowAdmission(args());
  assert.equal(r.state, 'OFFLINE_PREFLIGHT_ONLY');
  assert.equal(r.allowedToExecute, false);
  assert.equal(r.allowedToClaim, false);
  assert.equal(r.allowedToUseSecrets, false);
});

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
