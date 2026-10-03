import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL(
    '../supabase/migrations/20261003030000_backfill_pre_beta_v2_valid_reads.sql',
    import.meta.url
  ),
  'utf8'
);

function betaV2Eligible({
  bodyChars = 1000,
  readingProgress = 0.8,
  foregroundSeconds = 30,
  novelPublished = true,
  episodePublished = true,
  ownWork = false,
  existingEvent = false
}) {
  const scaledForeground = Math.ceil((30 * Math.max(bodyChars, 1)) / 800);
  const foregroundThreshold =
    bodyChars < 800 ? Math.min(30, Math.max(10, scaledForeground)) : 30;

  return (
    novelPublished &&
    episodePublished &&
    !ownWork &&
    !existingEvent &&
    readingProgress >= 0.8 &&
    foregroundSeconds >= foregroundThreshold &&
    foregroundSeconds < 60
  );
}

test('pre-beta-v2 TTS backfill freezes the reviewed 13-session allowlist', () => {
  const targetBlock = sql.match(
    /INSERT INTO _novelight_pre_beta_v2_valid_read_targets \(session_id\)\s*VALUES([\s\S]*?);/u
  );
  assert.ok(targetBlock, 'target allowlist must exist');

  const uuidPattern =
    /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gu;
  const ids = targetBlock[1].match(uuidPattern) ?? [];
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
});

test('migration retains the historical qualification contract and idempotency guards', () => {
  assert.match(sql, /JOIN public\.reader_reading_progress rp/u);
  assert.match(sql, /rp\.progress_ratio >= CASE/u);
  assert.match(sql, /e\.status = 'published'/u);
  assert.match(sql, /n\.status = 'published'/u);
  assert.match(sql, /s\.reader_id <> n\.user_id/u);
  assert.match(sql, /s\.foreground_seconds < 60/u);
  assert.match(
    sql,
    /ON CONFLICT \(reader_id, episode_id_snapshot\) DO NOTHING/u
  );
  assert.match(sql, /ON CONFLICT \(event_key\) DO NOTHING/u);
  assert.match(
    sql,
    /'valid_read:' \|\| v\.reader_id::text \|\| ':' \|\| v\.episode_id_snapshot/u
  );
  assert.doesNotMatch(sql, /INSERT INTO public\.scout_xp_ledger/iu);
});

test('old 60-second rule fail becomes eligible at beta-v2 30 seconds', () => {
  assert.equal(betaV2Eligible({ foregroundSeconds: 30 }), true);
  assert.equal(30 < 60, true);
});

test('TTS-like historical progress uses reading progress when session telemetry lagged', () => {
  const sessionTelemetryProgress = 0;
  const readingProgress = 1;

  assert.equal(sessionTelemetryProgress < 0.8, true);
  assert.equal(betaV2Eligible({ readingProgress, foregroundSeconds: 32 }), true);
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

test('existing reader/episode event is excluded and SQL remains idempotent', () => {
  assert.equal(betaV2Eligible({ existingEvent: true }), false);
  assert.match(
    sql,
    /ON CONFLICT \(reader_id, episode_id_snapshot\) DO NOTHING/u
  );
  assert.match(sql, /ON CONFLICT \(event_key\) DO NOTHING/u);
});

test('short episodes retain the scaled foreground threshold', () => {
  assert.equal(
    betaV2Eligible({
      bodyChars: 598,
      readingProgress: 0.8,
      foregroundSeconds: 23
    }),
    true
  );
  assert.equal(
    betaV2Eligible({
      bodyChars: 598,
      readingProgress: 0.8,
      foregroundSeconds: 22
    }),
    false
  );
});
