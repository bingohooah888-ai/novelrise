import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20261003030000_backfill_pre_beta_v2_valid_reads.sql';
const sql = await readFile(migrationPath, 'utf8');

function requiredForeground(bodyChars) {
  if (bodyChars >= 800) return 30;
  const scaled = Math.ceil((30 * Math.max(bodyChars, 1)) / 800);
  return Math.min(30, Math.max(10, scaled));
}

function betaV2Eligible(options = {}) {
  const bodyChars = options.bodyChars ?? 1000;
  const readingProgress = options.readingProgress ?? 0.8;
  const foregroundSeconds = options.foregroundSeconds ?? 30;
  const novelPublished = options.novelPublished ?? true;
  const episodePublished = options.episodePublished ?? true;
  const ownWork = options.ownWork ?? false;
  const existingEvent = options.existingEvent ?? false;

  return (
    novelPublished &&
    episodePublished &&
    !ownWork &&
    !existingEvent &&
    readingProgress >= 0.8 &&
    foregroundSeconds >= requiredForeground(bodyChars) &&
    foregroundSeconds < 60
  );
}

test('backfill freezes the reviewed 13-session allowlist', () => {
  const targetBlock = sql.match(
    /INSERT INTO _novelight_pre_beta_v2_valid_read_targets[\s\S]*?;/u
  );
  assert.ok(targetBlock);

  const uuidPattern = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gu;
  const ids = targetBlock[0].match(uuidPattern) ?? [];
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
});

test('migration preserves qualification and dedupe contracts', () => {
  assert.match(sql, /JOIN public\.reader_reading_progress rp/u);
  assert.match(sql, /rp\.progress_ratio >= CASE/u);
  assert.match(sql, /e\.status = 'published'/u);
  assert.match(sql, /n\.status = 'published'/u);
  assert.match(sql, /s\.reader_id <> n\.user_id/u);
  assert.match(sql, /s\.foreground_seconds < 60/u);
  assert.match(sql, /ON CONFLICT \(reader_id, episode_id_snapshot\)/u);
  assert.match(sql, /ON CONFLICT \(event_key\) DO NOTHING/u);
  assert.match(sql, /'valid_read:' \|\| v\.reader_id::text/u);
  assert.doesNotMatch(sql, /INSERT INTO public\.scout_xp_ledger/iu);
});

test('old 60-second miss qualifies at beta-v2 30 seconds', () => {
  assert.equal(betaV2Eligible({ foregroundSeconds: 30 }), true);
});

test('TTS-like stored progress qualifies despite stale session progress', () => {
  const sessionProgress = 0;
  assert.equal(sessionProgress < 0.8, true);
  assert.equal(
    betaV2Eligible({ readingProgress: 1, foregroundSeconds: 32 }),
    true
  );
});

test('progress below 80 percent is excluded', () => {
  assert.equal(
    betaV2Eligible({ readingProgress: 0.799, foregroundSeconds: 45 }),
    false
  );
});

test('foreground below beta-v2 threshold is excluded', () => {
  assert.equal(
    betaV2Eligible({ readingProgress: 1, foregroundSeconds: 29 }),
    false
  );
});

test('own-work and unpublished reads are excluded', () => {
  assert.equal(betaV2Eligible({ ownWork: true }), false);
  assert.equal(betaV2Eligible({ novelPublished: false }), false);
  assert.equal(betaV2Eligible({ episodePublished: false }), false);
});

test('existing reader-episode event is excluded', () => {
  assert.equal(betaV2Eligible({ existingEvent: true }), false);
});

test('short episodes keep the scaled foreground threshold', () => {
  const passing = {
    bodyChars: 598,
    readingProgress: 0.8,
    foregroundSeconds: 23
  };
  const failing = { ...passing, foregroundSeconds: 22 };

  assert.equal(betaV2Eligible(passing), true);
  assert.equal(betaV2Eligible(failing), false);
});
