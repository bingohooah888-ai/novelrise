import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../novelight-scout-title-toast.js', import.meta.url),
  'utf8'
);

test('SCOUT title award checks are event-driven with a low-frequency fallback', () => {
  assert.match(source, /SCOUT_TITLE_TOAST_FALLBACK_POLL_MS\s*=\s*60000/);
  assert.doesNotMatch(source, /SCOUT_TITLE_TOAST_POLL_MS\s*=\s*3000/);
  assert.doesNotMatch(source, /setInterval\([^)]*,\s*3000\s*\)/);
  assert.match(source, /novelight:scout-record-updated/);
  assert.match(source, /void check\(\);\s*startFallbackTimer\(\);/);
});

test('SCOUT fallback polling stops while the page is hidden', () => {
  assert.match(source, /document\.visibilityState !== 'visible'/);
  assert.match(
    source,
    /visibilitychange[\s\S]*document\.visibilityState !== 'visible'[\s\S]*stopFallbackTimer\(\)/
  );
  assert.match(source, /window\.clearInterval\(monitorState\.timer\)/);
});

test('SCOUT title watcher prevents duplicate timers and concurrent checks', () => {
  assert.match(source, /__novelightScoutTitleToastWatcherInstalled/);
  assert.match(source, /monitorState\.timer/);
  assert.match(source, /monitorState\.inFlight/);
  assert.match(
    source,
    /if \(monitorState\.inFlight \|\| document\.visibilityState !== 'visible'\) return/
  );
  assert.match(
    source,
    /document\.visibilityState !== 'visible' \|\|\s*monitorState\.timer/
  );
});

test('SCOUT award lookup and toast presentation remain intact', () => {
  assert.match(source, /\/api\/scout-badge-awards\?since=/);
  assert.match(source, /awards\.forEach\(showToast\)/);
  assert.match(source, /SCOUT称号を獲得/);
  assert.match(source, /aria-live/);
  assert.match(source, /SCOUT_TITLE_TOAST_VISIBLE_MS\s*=\s*5000/);
});
