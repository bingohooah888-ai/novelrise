import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { installHostedCommunityFlags } from './e2e/staging/community-hosted-flag-bootstrap.mjs';

test('isolated browser flag tolerates real strict-mode public OFF bootstrap', () => {
  const preview = {};
  installHostedCommunityFlags(preview);
  (function siteReleaseDefaults() {
    'use strict';
    preview.NOVELIGHT_COMMUNITY_FLAGS = Object.freeze({
      timeline: false,
      board: false
    });
  })();
  assert.deepEqual(preview.NOVELIGHT_COMMUNITY_FLAGS, {
    timeline: true,
    board: false
  });
  assert.ok(Object.isFrozen(preview.NOVELIGHT_COMMUNITY_FLAGS));
  assert.equal(
    Object.getOwnPropertyDescriptor(preview, 'NOVELIGHT_COMMUNITY_FLAGS')
      .configurable,
    false
  );
});

test('browser flags reject unexpected mutations', () => {
  const preview = {};
  installHostedCommunityFlags(preview);
  for (const unexpected of [
    { timeline: true, board: true },
    { timeline: true, board: false },
    { timeline: false, board: false, extra: true },
    null
  ]) {
    assert.throws(
      () => {
        preview.NOVELIGHT_COMMUNITY_FLAGS = unexpected;
      },
      /HOSTED_COMMUNITY_BROWSER_DENIED/u
    );
  }
  assert.throws(
    () => installHostedCommunityFlags(preview),
    /HOSTED_COMMUNITY_BROWSER_DENIED/u
  );
  assert.equal(preview.NOVELIGHT_COMMUNITY_FLAGS.timeline, true);
  assert.equal(preview.NOVELIGHT_COMMUNITY_FLAGS.board, false);
});

test('existing Preview Supabase isolation is preserved', () => {
  const site = readFileSync(
    new URL('../novelight-client.js', import.meta.url),
    'utf8'
  );
  const browserPath = new URL(
    './e2e/staging/community-hosted-auth-write.spec.js',
    import.meta.url
  );
  const browser = readFileSync(browserPath, 'utf8');
  assert.match(site, /installPreviewSupabaseBootstrap\(\)/u);
  assert.match(site, /loadStagingBrowserConfigSync\(\)/u);
  assert.match(browser, /addInitScript\(installHostedCommunityFlags\)/u);
  assert.match(browser, /NOVELIGHT_HOSTED_AUTH_WRITE_APPROVED/u);
  assert.match(browser, /PROD_REF/u);
  assert.match(browser, /SHARED_REF/u);
});
