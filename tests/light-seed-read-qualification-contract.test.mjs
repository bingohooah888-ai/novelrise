import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [ttsSource, migrationSource] = await Promise.all([
  readFile(new URL('../novelight-reader-tts.js', import.meta.url), 'utf8'),
  readFile(
    new URL('../supabase/migrations/20261003020000_tune_valid_read_thresholds_for_tts.sql', import.meta.url),
    'utf8'
  )
]);

test('TTS reaches valid-read eligibility at 80% without faking interaction signals', () => {
  assert.match(ttsSource, /TTS_VALID_READ_RATIO\s*=\s*0\.8/u);
  assert.match(ttsSource, /record_valid_read_progress/u);
  assert.match(ttsSource, /p_interaction_count:\s*0/u);
  assert.match(ttsSource, /documentRef\.visibilityState\s*!==\s*'visible'/u);
});

test('TTS completion records 100% reading progress', () => {
  assert.match(ttsSource, /completed \? 1 : ttsProgressRatio/u);
  assert.match(ttsSource, /reader_reading_progress/u);
  assert.match(ttsSource, /progress_ratio:\s*clamp\(stored\.progressRatio\)/u);
});

test('beta valid-read rules require 80% normal progress and 30 seconds foreground', () => {
  assert.match(migrationSource, /normal_progress_ratio\s*=\s*0\.80/u);
  assert.match(migrationSource, /short_progress_ratio\s*=\s*0\.80/u);
  assert.match(migrationSource, /normal_foreground_seconds\s*=\s*30/u);
  assert.match(migrationSource, /rule_version\s*=\s*'beta-v2'/u);
});
