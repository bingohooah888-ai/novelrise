import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  assertCommunityReuseAdmission,
  REUSE_PREFIX,
  REUSE_SHA,
  REUSE_URL
} from '../scripts/community-preview-reuse-admission.mjs';
import {
  verifyCommunityExistingPreviewReadOnly
} from '../scripts/community-existing-preview-readonly.mjs';

const mainSha = 'a'.repeat(40);
function input() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 999,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: REUSE_PREFIX + JSON.stringify({
        scope: 'community-phase1-existing-preview-readonly',
        mainSha,
        candidateSha: REUSE_SHA,
        previewUrl: REUSE_URL,
        confirmation: 'STAGING APPROVED'
      })
    },
    main: { object: { sha: mainSha } },
    ledgerPages: [[{
      user: { login: 'github-actions[bot]' },
      body: 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ' +
        JSON.stringify({
          requestCommentId: '6199670925',
          mainSha: 'b'.repeat(40),
          candidateSha: REUSE_SHA,
          runId: '38788191875',
          result: 'failure'
        })
    }]]
  };
}

test('OWNER approval can reuse the original immutable Preview once', () => {
  const x = input();
  const decision = assertCommunityReuseAdmission(x);
  assert.equal(decision.candidateSha, REUSE_SHA);
  assert.equal(decision.previewUrl, REUSE_URL);
  x.comment.author_association = 'CONTRIBUTOR';
  assert.throws(
    () => assertCommunityReuseAdmission(x),
    /COMMUNITY_PREVIEW_REUSE_DENIED/u
  );
});

test('reject reused approval, changed URL, or absent original ledger', () => {
  const x = input();
  x.comment.body = x.comment.body.replace(
    'novelrise-ibyeza739-ranobe1',
    'novelrise'
  );
  assert.throws(
    () => assertCommunityReuseAdmission(x),
    /target mismatch/u
  );
  const y = input();
  y.ledgerPages[0].push({
    body: 'NOVELIGHT_STAGING_COMMUNITY_REUSE_CLAIMED ' +
      JSON.stringify({
        requestCommentId: '999',
        mainSha,
        candidateSha: REUSE_SHA,
        runId: '7'
      })
  });
  assert.throws(() => assertCommunityReuseAdmission(y), /already claimed/u);
  const z = input();
  z.ledgerPages = [[]];
  assert.throws(() => assertCommunityReuseAdmission(z), /not ledger-proven/u);
});

const staging = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const config = JSON.stringify({
  supabaseUrl: staging,
  supabasePublishableKey: 'sb_publishable_test'
});
const routes = {
  '/api/staging-browser-config': config,
  '/community.html':
    '<title>交流広場 | NOVELIGHT</title>' +
    '<script src="novelight-client.js"></script>' +
    '<script src="novelight-community.js" defer></script>',
  '/novelight-client.js':
    'installPreviewSupabaseBootstrap(); loadStagingBrowserConfigSync',
  '/novelight-community.js': 'NOVELIGHT_COMMUNITY_FLAGS',
  '/novelight-community-config.js': 'timeline:false, board:false'
};
const env = {
  EXPECTED_REVISION: REUSE_SHA,
  CANONICAL_STAGING_URL: REUSE_URL,
  STAGING_EXPECTED_SUPABASE_URL: staging,
  STAGING_EXPECTED_PUBLISHABLE_KEY: 'sb_publishable_test',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'test-secret'
};

test('protected verification uses GET only and never deploys', async () => {
  const calls = [];
  const result = await verifyCommunityExistingPreviewReadOnly({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      const pathname = new URL(url).pathname;
      return new Response(routes[pathname], { status: 200 });
    }
  });
  assert.equal(result.interactiveProof, false);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.method === 'GET'));
  assert.ok(calls.every((call) => call.url.startsWith(REUSE_URL)));
});

test('rejects missing bypass before network and Production browser target', async () => {
  await assert.rejects(
    verifyCommunityExistingPreviewReadOnly({
      env: { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: '' },
      fetchImpl: () => {
        throw new Error('network should not start');
      }
    }),
    /bypass missing/u
  );
  await assert.rejects(
    verifyCommunityExistingPreviewReadOnly({
      env,
      fetchImpl: async (url) => new Response(
        new URL(url).pathname === '/api/staging-browser-config'
          ? JSON.stringify({
            supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co',
            supabasePublishableKey: 'sb_publishable_test'
          })
          : '',
        { status: 200 }
      )
    }),
    /browser config differs/u
  );
});

test('new workflow cannot deploy, dispatch, or skip OWNER gating', () => {
  const yaml = readFileSync(
    new URL(
      '../.github/workflows/community-existing-preview-readonly.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(yaml, /author_association == 'OWNER'/u);
  assert.match(yaml, /NOVELIGHT_STAGING_COMMUNITY_REUSE_APPROVE/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(yaml, /community-existing-preview-readonly\.mjs verify/u);
  assert.doesNotMatch(yaml, /vercel-preview-deployment/u);
  assert.doesNotMatch(yaml, /workflow_dispatch:/u);
  assert.doesNotMatch(yaml, /forceNew/u);
});
