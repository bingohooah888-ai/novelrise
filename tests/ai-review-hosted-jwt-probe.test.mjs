import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertVerifiedVercelPreview,
  validateHostedJwtProofConfig,
  verifyHostedPreviewViaVercel
} from '../scripts/ai-review-hosted-jwt-probe.mjs';

function sample() {
  return {
    NOVELIGHT_HOSTED_JWT_ADMITTED: '1',
    STAGING_PROJECT_REF: 'wmlzjgvxgoyrovdhbqbg',
    NOVELIGHT_HOSTED_TEST_USER_ID: '00000000-0000-4000-8000-000000000943',
    NOVELIGHT_HOSTED_TEST_USER_EMAIL: 'ai-review-jwt@example.invalid',
    NOVELIGHT_HOSTED_TEST_NOVEL_ID: '998891003',
    NOVELIGHT_HOSTED_TEST_USER_PASSWORD: 'not-a-real-test-secret',
    VERCEL_AUTOMATION_BYPASS_SECRET: 'not-a-real-bypass',
    APPROVED_MAIN_SHA: 'a'.repeat(40),
    APPROVED_CANDIDATE_SHA: 'b'.repeat(40),
    APPROVED_PREVIEW_SHA: 'b'.repeat(40),
    STAGING_APPROVAL_COMMENT_ID: '70001',
    NOVELIGHT_HOSTED_PREVIEW_URL:
      'https://novelrise-test12345-ranobe1.vercel.app/',
    NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID: 'dpl_TestPreviewAB12345',
    VERCEL_READONLY_API_TOKEN: 'test-only-readonly-token-never-use'
  };
}

test('valid isolated JWT proof config yields only nonsecret pins', () => {
  const config = validateHostedJwtProofConfig(sample());
  assert.equal(config.stage, 'https://wmlzjgvxgoyrovdhbqbg.supabase.co');
  assert.equal(config.novelId, 998891003);
  assert.equal(
    config.preview,
    'https://novelrise-test12345-ranobe1.vercel.app'
  );
  assert.equal(Object.isFrozen(config), true);
  assert.equal(JSON.stringify(config).includes('not-a-real'), false);
});

for (const field of [
  'NOVELIGHT_HOSTED_JWT_ADMITTED',
  'NOVELIGHT_HOSTED_TEST_USER_PASSWORD',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'VERCEL_READONLY_API_TOKEN',
  'NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID',
  'APPROVED_PREVIEW_SHA',
  'STAGING_APPROVAL_COMMENT_ID'
]) {
  test('hosted JWT proof rejects missing ' + field, () => {
    const entry = sample();
    delete entry[field];
    assert.throws(
      () => validateHostedJwtProofConfig(entry),
      /AI_HOSTED_JWT_PROOF_DENIED/u
    );
  });
}

test('hosted JWT proof rejects production or foreign staging', () => {
  const entry = sample();
  entry.STAGING_PROJECT_REF = 'fiepaguycecrredwrcwx';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects Preview mismatched to approved candidate', () => {
  const entry = sample();
  entry.APPROVED_PREVIEW_SHA = 'c'.repeat(40);
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects arbitrary or production URL', () => {
  const entry = sample();
  entry.NOVELIGHT_HOSTED_PREVIEW_URL = 'https://novelight.example.com/';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
  entry.NOVELIGHT_HOSTED_PREVIEW_URL =
    'https://novelrise-test12345-ranobe1.vercel.app/secret';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects any real or alternate user', () => {
  const entry = sample();
  entry.NOVELIGHT_HOSTED_TEST_USER_ID = '00000000-0000-4000-8000-000000000941';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

function verifiedDeployment() {
  return {
    id: 'dpl_TestPreviewAB12345',
    project: { id: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe' },
    name: 'novelrise',
    url: 'novelrise-test12345-ranobe1.vercel.app',
    target: null,
    readyState: 'READY',
    meta: {
      githubOrg: 'bingohooah888-ai',
      githubRepo: 'novelrise',
      githubCommitRef: 'codex/ai020704-staging-candidate-db-20261028',
      githubCommitSha: 'b'.repeat(40)
    }
  };
}

test('Vercel must attest exact project, READY Preview and Git commit', () => {
  const config = validateHostedJwtProofConfig(sample());
  assert.equal(assertVerifiedVercelPreview(config, verifiedDeployment()), true);
  for (const patch of [
    { id: 'dpl_UnknownPreview' },
    { project: { id: 'prj_Unknown' } },
    { name: 'other-project' },
    { url: 'attacker.vercel.app' },
    { target: 'production' },
    { readyState: 'CANCELED' },
    {
      meta: {
        ...verifiedDeployment().meta,
        githubCommitSha: 'c'.repeat(40)
      }
    },
    {
      meta: {
        ...verifiedDeployment().meta,
        githubOrg: 'some-other-owner'
      }
    }
  ]) {
    const suspect = { ...verifiedDeployment(), ...patch };
    assert.throws(
      () => assertVerifiedVercelPreview(config, suspect),
      /AI_HOSTED_JWT_PROOF_DENIED/u
    );
  }
});

test('Vercel attestation contacts only its API and does not expose JWT', async () => {
  const env = sample();
  const config = validateHostedJwtProofConfig(env);
  let seen = 0;
  await verifyHostedPreviewViaVercel(config, env, async (url, opts) => {
    seen += 1;
    assert.equal(
      url,
      'https://api.vercel.com/v13/deployments/dpl_TestPreviewAB12345' +
        '?teamId=team_2XFgtRCPJQ6pbrEa4mOLQAEx'
    );
    assert.equal(opts.redirect, 'manual');
    assert.equal(
      opts.headers.authorization,
      'Bearer ' + env.VERCEL_READONLY_API_TOKEN
    );
    return {
      status: 200,
      async json() {
        return verifiedDeployment();
      }
    };
  });
  assert.equal(seen, 1);
});

test('Vercel preview rejects unverified deployment before remote requests', async () => {
  const env = sample();
  const config = validateHostedJwtProofConfig(env);
  await assert.rejects(
    verifyHostedPreviewViaVercel(config, env, async () => ({
      status: 403,
      async json() {
        throw new Error('should not parse response');
      }
    })),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});
