import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  MASTER_SYNC_RETRY_COOLDOWN_MS,
  isMasterProjectIdentityMismatch,
  masterSyncRetryNotBefore,
  shouldDeferMasterSyncAttempt
} from '../tools/novelight-commander/src/master-auto-sync-retry-policy.js';

const START = Date.parse('2026-10-14T06:00:00Z');

test('exact unsafe Project identity error is classified without suppressing other errors', () => {
  assert.equal(
    isMasterProjectIdentityMismatch(
      new Error(
        'Opened ChatGPT page does not visibly identify Project "NOVELIGHT". url=https://chatgpt.com/g/g-p-example/project'
      )
    ),
    true
  );
  for (const error of [
    new Error('GitHub API failed'),
    new Error('ChatGPT login is required'),
    new Error('Project upload failed'),
    new Error('Opened an unrelated ChatGPT page')
  ]) {
    assert.equal(isMasterProjectIdentityMismatch(error), false);
  }
});

test('identity errors, unavailable browser and sign-out respect persistent 30m retry cooldown', () => {
  assert.equal(MASTER_SYNC_RETRY_COOLDOWN_MS, 30 * 60 * 1000);
  const retryNotBeforeAt = masterSyncRetryNotBefore(START);
  for (const status of [
    'error',
    'login_required',
    'deferred_project_identity_unverified',
    'deferred_playwright_unavailable',
    'deferred_profile_busy'
  ]) {
    const state = { status, retryNotBeforeAt };
    assert.equal(shouldDeferMasterSyncAttempt(state, START), true);
    assert.equal(
      shouldDeferMasterSyncAttempt(
        state,
        START + MASTER_SYNC_RETRY_COOLDOWN_MS - 1
      ),
      true
    );
    assert.equal(
      shouldDeferMasterSyncAttempt(
        state,
        START + MASTER_SYNC_RETRY_COOLDOWN_MS
      ),
      false
    );
  }
});

test('healthy, busy and malformed cooldown records never suppress work', () => {
  const deadline = masterSyncRetryNotBefore(START);
  for (const status of ['synced', 'busy', '', 'testing']) {
    assert.equal(
      shouldDeferMasterSyncAttempt(
        { status, retryNotBeforeAt: deadline },
        START
      ),
      false
    );
  }
  assert.equal(
    shouldDeferMasterSyncAttempt(
      { status: 'error', retryNotBeforeAt: 'garbled' },
      START
    ),
    false
  );
  assert.equal(shouldDeferMasterSyncAttempt({ status: 'error' }, START), false);
  assert.throws(() => masterSyncRetryNotBefore(Number.NaN), /invalid/);
});

test('background retry change preserves fail-closed visible Project identity gate', () => {
  const bg = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-project-sync-background.js',
      import.meta.url
    ),
    'utf8'
  );
  const browser = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-project-sync.js',
      import.meta.url
    ),
    'utf8'
  );
  const daemon = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-auto-sync-daemon.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(bg, /DEFERRED_PROJECT_IDENTITY_UNVERIFIED/);
  assert.match(bg, /isMasterProjectIdentityMismatch/);
  assert.match(
    browser,
    /observation\.mainEmpty \|\| !\(await pageVisiblyNamesProject\(page, name\)\)/
  );
  assert.match(browser, /observeProjectPageLoad\(page\)/);
  assert.match(browser, /await waitForProjectMainRender\(page\)/);
  assert.match(browser, /safeProjectPageObservation\(page, loadCounts\)/);
  assert.match(browser, /expectedProjectId !== observedProjectId/);
  assert.match(browser, /Safe render counters=/);
  assert.match(daemon, /shouldDeferMasterSyncAttempt\(state\)/);
  assert.match(daemon, /retryNotBeforeAt: masterSyncRetryNotBefore\(\)/);
});
