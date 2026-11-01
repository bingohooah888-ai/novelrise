import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import {
  validateHostedBrowserProof,
  checkHostedBrowserPreview
} from '../.github/staging-ai-02-07-04/hosted-browser-gate.mjs';

const MAIN = 'f'.repeat(40);
const PREVIEW = 'https://novelrise-synthetic-abc-ranobe1.vercel.app';
const DEPLOY = 'dpl_SyntheticOnly987';
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const BRANCH = 'staging/ai-02-07-04-owner-ui-proof-20261101';
// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
const config = {
  NOVELIGHT_AI_020704_HOSTED_BROWSER_ADMITTED: '1',
  STAGING_PROJECT_REF: 'wmlzjgvxgoyrovdhbqbg',
  STAGING_SUPABASE_URL: STAGING,
  APPROVED_MAIN_SHA: MAIN,
  APPROVED_PREVIEW_SHA: MAIN,
  STAGING_APPROVAL_COMMENT_ID: '98765',
  NOVELIGHT_HOSTED_PREVIEW_URL: PREVIEW,
  NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID: DEPLOY,
  VERCEL_READONLY_API_TOKEN: 'synthetic-vercel-ro-token-only',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-protection-token'
};

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
function previewResponses() {
  const envs = Object.entries({
    SUPABASE_URL: STAGING,
    NOVELIGHT_STAGING_SUPABASE_URL: STAGING,
    NOVELIGHT_AI_ADMIN_USER_ID: '00000000-0000-4000-8000-000000000943',
    NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
    NOVELIGHT_AI_REVIEW_ENABLED: 'true',
    NOVELIGHT_AI_ENABLED: 'false',
    SUPABASE_SECRET_KEY: null,
    SUPABASE_PUBLISHABLE_KEY: null
  }).map(([key, value]) => ({
    key,
    value,
    type: value === null ? 'sensitive' : 'plain',
    gitBranch: BRANCH,
    target: ['preview'],
    updatedAt: 100
  }));
  return [
    {
      id: DEPLOY,
      project: { id: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe' },
      name: 'novelrise',
      url: new URL(PREVIEW).hostname,
      readyState: 'READY',
      target: null,
      createdAt: 200,
      meta: {
        githubOrg: 'bingohooah888-ai',
        githubRepo: 'novelrise',
        githubCommitRef: BRANCH,
        githubCommitSha: MAIN
      }
    },
    {
      id: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
      name: 'novelrise',
      ssoProtection: { deploymentType: 'all_except_custom_domains' }
    },
    { envs },
    {
      vercelEnv: 'preview',
      commitSha: MAIN,
      appBaseUrl: PREVIEW,
      supabase: { url: STAGING, serverSecretPresent: true },
      stripe: { secretKeyMode: 'test' }
    },
    {
      supabaseUrl: STAGING,
      supabasePublishableKey: 'sb_publishable_SyntheticOnly'
    }
  ];
}

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
function fetchResponses(data, reviewStatus = 401, aiStatus = 404) {
  let cursor = 0;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    cursor += 1;
    if (cursor <= data.length) {
      return { status: 200, json: async () => data[cursor - 1] };
    }
    if (cursor === data.length + 1) return { status: reviewStatus };
    if (cursor === data.length + 2) return { status: aiStatus };
    throw new Error('Unexpected synthetic network call');
  };
  return { fetcher, calls };
}

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
test('no approval or stale SHA refuses all hosted execution', () => {
  assert.throws(() => validateHostedBrowserProof({}), /DENIED/);
  assert.equal(validateHostedBrowserProof(config).sha, MAIN);
  const cases = [
    { NOVELIGHT_AI_020704_HOSTED_BROWSER_ADMITTED: undefined },
    { STAGING_PROJECT_REF: 'fiepaguycecrredwrcwx' },
    { STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co' },
    { APPROVED_PREVIEW_SHA: 'a'.repeat(40) },
    { STAGING_APPROVAL_COMMENT_ID: '0' },
    { NOVELIGHT_HOSTED_PREVIEW_URL: 'https://novelight.jp' },
    { NOVELIGHT_HOSTED_PREVIEW_URL: PREVIEW + '/story-notes.html' },
    { NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID: 'bad' },
    { VERCEL_READONLY_API_TOKEN: '' },
    { VERCEL_AUTOMATION_BYPASS_SECRET: '' }
  ];
  for (const changes of cases) {
    assert.throws(
      () => validateHostedBrowserProof({ ...config, ...changes }),
      /DENIED/,
      Object.keys(changes).join(',')
    );
  }
});

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
test('all eight Preview attestations pass without login or AI execution', async () => {
  const { fetcher, calls } = fetchResponses(previewResponses());
  assert.equal(
    await checkHostedBrowserPreview(validateHostedBrowserProof(config), config, fetcher),
    true
  );
  assert.equal(calls.length, 7);
  assert.equal(
    calls[5].url,
    PREVIEW + '/api/ai-owner-bible-review?novel_id=998891003'
  );
  assert.equal(
    calls[6].url,
    PREVIEW + '/api/ai-owner-bible-analyze?novel_id=998891003'
  );
});

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
test('preview mismatches, protection changes and AI activation deny', async () => {
  const variants = [
    (rows) => { rows[0].target = 'production'; },
    (rows) => { rows[0].createdAt = undefined; },
    (rows) => { rows[2].envs.find(x => x.key === 'SUPABASE_URL').target = ['production','preview']; },
    (rows) => { rows[2].envs.find(x => x.key === 'SUPABASE_SECRET_KEY').updatedAt = undefined; },
    (rows) => { rows[0].meta.githubCommitSha = 'a'.repeat(40); },
    (rows) => { rows[0].meta.githubCommitRef = 'main'; },
    (rows) => { rows[1].ssoProtection = null; },
    (rows) => { rows[2].envs.find(x => x.key === 'SUPABASE_URL').value = 'https://fiepaguycecrredwrcwx.supabase.co'; },
    (rows) => { rows[2].envs.find(x => x.key === 'NOVELIGHT_AI_ENABLED').value = 'true'; },
    (rows) => { rows[2].envs.find(x => x.key === 'SUPABASE_SECRET_KEY').type = 'plain'; },
    (rows) => { rows[3].stripe.secretKeyMode = 'live'; },
    (rows) => { rows[4].supabaseUrl = 'https://fiepaguycecrredwrcwx.supabase.co'; }
  ];
  for (const mutate of variants) {
    const data = previewResponses();
    mutate(data);
    const { fetcher } = fetchResponses(data);
    await assert.rejects(
      checkHostedBrowserPreview(validateHostedBrowserProof(config), config, fetcher),
      /DENIED/
    );
  }
  for (const states of [[200, 404], [401, 200]]) {
    const { fetcher } = fetchResponses(previewResponses(), ...states);
    await assert.rejects(
      checkHostedBrowserPreview(validateHostedBrowserProof(config), config, fetcher),
      /DENIED/
    );
  }
});

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
test('one-use OWNER workflow, mandatory cleanup, no external provider', () => {
  const workflow = readFileSync(
    '.github/workflows/ai-020704-hosted-browser-jwt-proof.yml',
    'utf8'
  );
  const runner = readFileSync(
    '.github/staging-ai-02-07-04/hosted-runner.mjs',
    'utf8'
  );
  const browser = readFileSync(
    'tests/e2e/ai-020704-hosted-review-browser.mjs',
    'utf8'
  );
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /synthetic-jwt-hosted-review-ui-only/);
  assert.match(workflow, /previewDeploymentId/);
  assert.match(workflow, /BROWSER_CLAIMED/);
  assert.match(workflow, /BROWSER_CONSUMED/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /Install browser test dependencies for runner Chrome/);
  const downloadCommand = workflow.split('\n').some((line) =>
    line.trimStart().startsWith('npm --prefix tests/e2e exec -- playwright install')
  );
  assert.equal(downloadCommand, false);
  assert.ok(
    browser.includes("chromium.launch({ headless: true, channel: 'chrome' })")
  );
  assert.doesNotMatch(workflow, /workflow_dispatch:|OPENAI_API_KEY|GEMINI_API_KEY/);
  assert.match(runner, /checkHostedBrowserPreview\(hosted,env\)/);
  assert.match(runner, /HOSTED_BROWSER_REVIEW_DECISION/);
  assert.match(runner, /SYNTHETIC_CLEANUP/);
  assert.match(runner, /FINAL_CENSUS/);
  assert.match(runner, /signOut\(token,'global'\)/);
  assert.match(browser, /'x-vercel-protection-bypass'/);
  assert.match(browser, /if \(url\.hostname === STAGING_HOST\)/);
  // Login redirect allowlist does not include story-notes. The browser
  // authenticates using an allowlisted author route before opening notes.
  const redirectSource = readFileSync('auth-reader-context.js', 'utf8');
  assert.ok(redirectSource.includes("'/my-novels.html'"));
  assert.ok(browser.includes("encodeURIComponent('my-novels.html')"));
  assert.match(browser, /phase = 'LOGIN_REDIRECT'/);
  assert.match(browser, /phase = 'STORY_PAGE'/);
  assert.match(browser, /phase = 'SIGNOUT'/);
  assert.match(runner, /STAGING_AI_020704_BROWSER_FAILURE_PHASE/);
  assert.match(browser, /AI_020704_BROWSER_FAILURE_PHASE/);
  assert.ok(browser.includes('await accept.click()'));
  assert.ok(browser.includes('apiPosts.length !== 1'));
  assert.doesNotMatch(browser, /createOpenAiTextProvider|createGeminiTextProvider/);
});
