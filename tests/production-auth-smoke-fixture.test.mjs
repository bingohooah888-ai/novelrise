import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixtureSource = readFileSync(
  'scripts/production-auth-smoke-fixture.mjs',
  'utf8'
);
const smokeSource = readFileSync(
  'tests/e2e/production-auth/authenticated-smoke.spec.js',
  'utf8'
);

test('production auth smoke records and cleans Chapter 40 thumbnail renders', () => {
  assert.match(smokeSource, /assertChapter40ComposerReady/);
  assert.match(smokeSource, /saveThumbnailRenderPath/);
  assert.match(
    smokeSource,
    /waitForThumbnailRenderAction\([\s\S]*'prepare-upload'/
  );
  assert.match(
    smokeSource,
    /waitForThumbnailRenderAction\([\s\S]*'finalize-upload'/
  );
  assert.match(smokeSource, /composition\.render_url/);
  assert.match(smokeSource, /renderStoragePathPattern/);
  assert.doesNotMatch(smokeSource, /candidate\.json\(\)/);
  assert.doesNotMatch(smokeSource, /waitForThumbnailRenderResult/);
  assert.match(fixtureSource, /novel-thumbnail-renders/);
  assert.match(fixtureSource, /thumbnailRenderPathPattern/);
  assert.match(fixtureSource, /\.from\('novel_thumbnail_compositions'\)/);
  assert.match(fixtureSource, /\.remove\(safePaths\)/);
});

test('production auth smoke cleanup tolerates a pre-fixture safety stop', () => {
  assert.match(fixtureSource, /const admin = supabaseSecretKey/);
  assert.match(fixtureSource, /function requireAdmin\(\)/);
  assert.match(
    fixtureSource,
    /if \(!userIds\.length && !thumbnailRenderPaths\.length\)/
  );
  assert.match(
    fixtureSource,
    /No ephemeral production authenticated-smoke users or renders to clean\./
  );
  assert.doesNotMatch(
    fixtureSource,
    /if \(!supabaseSecretKey\) throw new Error\('SUPABASE_SECRET_KEY is required\.'\);/
  );
});
