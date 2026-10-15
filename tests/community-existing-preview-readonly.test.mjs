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
import { verifyCommunityExistingPreviewReadOnly } from '../scripts/community-existing-preview-readonly.mjs';

const mainSha = 'a'.repeat(40);
const staging = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const key = 'sb_publishable_test';
const originalPrefix = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ';
const claimedPrefix = 'NOVELIGHT_STAGING_COMMUNITY_REUSE_CLAIMED ';

function approval() {
  const payload = {
    scope: 'community-phase1-existing-preview-readonly',
    mainSha,
    candidateSha: REUSE_SHA,
    previewUrl: REUSE_URL,
    confirmation: 'STAGING APPROVED'
  };
  const original = {
    requestCommentId: '6199670925',
    mainSha: 'b'.repeat(40),
    candidateSha: REUSE_SHA,
    runId: '38788191875',
    result: 'failure'
  };
  const originalRow = {
    user: { login: 'github-actions[bot]' },
    body: originalPrefix + JSON.stringify(original)
  };
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
      body: REUSE_PREFIX + JSON.stringify(payload)
    },
    main: { object: { sha: mainSha } },
    ledgerPages: [[originalRow]]
  };
}

test('OWNER may approve exact existing Preview only once', () => {
  const x = approval();
  assert.equal(assertCommunityReuseAdmission(x).previewUrl, REUSE_URL);
  x.comment.author_association = 'MEMBER';
  assert.throws(() => assertCommunityReuseAdmission(x), /DENIED/u);
  x.comment.author_association = 'OWNER';
  const claimed = {
    requestCommentId: '999',
    mainSha,
    candidateSha: REUSE_SHA,
    runId: '7'
  };
  x.ledgerPages[0].push({ body: claimedPrefix + JSON.stringify(claimed) });
  assert.throws(() => assertCommunityReuseAdmission(x), /already claimed/u);
});

test('Preview verifier makes GET requests only', async () => {
  const flags = 'timeline:false, board:false';
  const config = JSON.stringify({
    supabaseUrl: staging,
    supabasePublishableKey: key
  });
  const html =
    '<title>交流広場 | NOVELIGHT</title>' +
    '<script src="novelight-client.js"></script>' +
    '<script src="novelight-community.js" defer></script>';
  const bodies = {
    '/api/staging-browser-config': config,
    '/community.html': html,
    '/novelight-client.js':
      'installPreviewSupabaseBootstrap(); loadStagingBrowserConfigSync',
    '/novelight-community.js': 'NOVELIGHT_COMMUNITY_FLAGS',
    '/novelight-community-config.js': flags
  };
  const env = {
    EXPECTED_REVISION: REUSE_SHA,
    CANONICAL_STAGING_URL: REUSE_URL,
    STAGING_EXPECTED_SUPABASE_URL: staging,
    STAGING_EXPECTED_PUBLISHABLE_KEY: key,
    VERCEL_AUTOMATION_BYPASS_SECRET: 'test-secret'
  };
  const calls = [];
  const result = await verifyCommunityExistingPreviewReadOnly({
    env,
    fetchImpl: async (url, options) => {
      calls.push(options.method);
      const path = new URL(url).pathname;
      return new Response(bodies[path], { status: 200 });
    }
  });
  assert.equal(result.interactiveProof, false);
  assert.deepEqual(calls, Array(5).fill('GET'));
});

test('existing Preview workflow cannot create or redeploy a build', () => {
  const path = '../.github/workflows/community-existing-preview-readonly.yml';
  const yaml = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(yaml, /author_association == 'OWNER'/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(yaml, /NOVELIGHT_STAGING_COMMUNITY_REUSE_APPROVE/u);
  assert.doesNotMatch(yaml, /workflow_dispatch:/u);
  assert.doesNotMatch(yaml, /vercel-preview-deployment/u);
});
