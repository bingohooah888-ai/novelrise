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
const readinessWorkflow = readFileSync(
  '.github/workflows/production-readiness-smoke.yml',
  'utf8'
);
const staleRecoveryWorkflow = readFileSync(
  '.github/workflows/production-auth-smoke-stale-recovery.yml',
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

test('production readiness automatically dispatches the next Auth Smoke request', () => {
  assert.match(readinessWorkflow, /actions: write/);
  assert.match(readinessWorkflow, /tests\/e2e\/production-auth\/\*\*/);
  assert.match(
    readinessWorkflow,
    /production-auth-smoke-stale-recovery\.yml/
  );
  assert.match(
    readinessWorkflow,
    /Dispatch scoped Production Auth Smoke approval request/
  );
  assert.match(
    readinessWorkflow,
    /if: success\(\) && github\.event_name != 'schedule'/
  );
  assert.match(
    readinessWorkflow,
    /actions\/workflows\/production-auth-smoke-request\.yml\/dispatches/
  );
  assert.match(readinessWorkflow, /current_main.*GITHUB_SHA/s);
});

test('stale Production Auth Smoke approval recovers without another workflow click', () => {
  assert.match(staleRecoveryWorkflow, /issue_comment:/);
  assert.match(staleRecoveryWorkflow, /author_association == 'OWNER'/);
  assert.match(
    staleRecoveryWorkflow,
    /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE /
  );
  assert.match(staleRecoveryWorkflow, /current_main.*approved_sha/s);
  assert.match(
    staleRecoveryWorkflow,
    /NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED /
  );
  assert.match(staleRecoveryWorkflow, /gh issue close/);
  assert.match(staleRecoveryWorkflow, /production-readiness-smoke\.yml/);
  assert.match(staleRecoveryWorkflow, /production-auth-smoke-request\.yml/);
  assert.match(
    staleRecoveryWorkflow,
    /actions\/workflows\/\$next_workflow\/dispatches/
  );
});
