import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ttsUrl = new URL('../novelight-reader-tts.js', import.meta.url);
const migrationUrl = new URL(
  '../supabase/migrations/20261003020000_tune_valid_read_thresholds_for_tts.sql',
  import.meta.url
);
const [ttsSource, migrationSource] = await Promise.all([
  readFile(ttsUrl, 'utf8'),
  readFile(migrationUrl, 'utf8')
]);

test('TTS valid read starts at 80 percent', () => {
  assert.match(ttsSource, /TTS_VALID_READ_RATIO\s*=\s*0\.8/u);
  assert.match(ttsSource, /record_valid_read_progress/u);
  assert.match(ttsSource, /p_interaction_count:\s*0/u);
});

test('TTS completion records full reading progress', () => {
  assert.match(ttsSource, /completed \? 1 : ttsProgressRatio/u);
  assert.match(ttsSource, /reader_reading_progress/u);
});

test('valid read requires 80 percent and 30 seconds', () => {
  assert.match(migrationSource, /normal_progress_ratio\s*=\s*0\.80/u);
  assert.match(migrationSource, /short_progress_ratio\s*=\s*0\.80/u);
  assert.match(migrationSource, /normal_foreground_seconds\s*=\s*30/u);
  assert.match(migrationSource, /rule_version\s*=\s*'beta-v2'/u);
});

test('interactions cannot bypass progress', () => {
  assert.match(
    migrationSource,
    /if v_foreground_signal and v_progress_signal then/u
  );
  assert.doesNotMatch(
    migrationSource,
    /v_foreground_signal and \(v_progress_signal or v_interaction_signal\)/u
  );
  assert.match(migrationSource, /interaction_signal/u);
});
