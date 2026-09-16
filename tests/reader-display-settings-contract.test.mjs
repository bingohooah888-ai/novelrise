import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const episodeUrl = new URL('../episode.html', import.meta.url);
const scriptUrl = new URL('../novelight-reading-settings.js', import.meta.url);
const cssUrl = new URL('../novelight-reading-settings.css', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('episode mounts reader display settings without replacing reading tracking', async () => {
  const episode = await text(episodeUrl);

  assert.match(episode, /id="readingSettingsMount"/);
  assert.match(episode, /novelight-reading-settings\.css/);
  assert.match(episode, /novelight-reading-settings\.js/);
  assert.match(episode, /NovelightReadingSettings\.mount\(\)/);
  assert.match(episode, /record_valid_read_progress/);
  assert.match(episode, /record_novel_exposure_conversion/);
  assert.match(episode, /NovelightClient\.recordJourney/);
});

test('reader settings persist only allowlisted presentation choices on this device', async () => {
  const script = await text(scriptUrl);

  assert.match(script, /novelight:reading-settings:v1/);
  assert.match(script, /fontSize: 'standard'/);
  assert.match(script, /lineHeight: 'standard'/);
  assert.match(script, /theme: 'light'/);
  assert.match(script, /width: 'standard'/);
  assert.match(script, /Object\.prototype\.hasOwnProperty\.call/);
  assert.match(script, /global\.localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(script, /global\.localStorage\.setItem\(STORAGE_KEY/);
  assert.doesNotMatch(script, /supabase|\.rpc\(|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(script, /SCOUT.*=|Rank.*=|LIGHT SEED.*=/);
});

test('reader settings expose font size, line spacing, theme, width and reset controls', async () => {
  const script = await text(scriptUrl);

  assert.match(script, /文字サイズ/);
  assert.match(script, /行間/);
  assert.match(script, /読書テーマ/);
  assert.match(script, /本文横幅/);
  assert.match(script, /標準に戻す/);
  assert.match(script, /この端末の読書表示だけを変更します/);
  assert.match(script, /作品の評価やSCOUT判定には影響しません/);
});

test('reader settings apply presentation through bounded CSS variables and theme state', async () => {
  const [script, css] = await Promise.all([text(scriptUrl), text(cssUrl)]);

  assert.match(script, /--reader-font-size/);
  assert.match(script, /--reader-line-height/);
  assert.match(script, /--reader-max-width/);
  assert.match(script, /body\.dataset\.readingTheme/);
  assert.match(css, /font-size: var\(--reader-font-size\)/);
  assert.match(css, /line-height: var\(--reader-line-height\)/);
  assert.match(css, /max-width: var\(--reader-max-width\)/);
  assert.match(css, /data-reading-theme='dark'/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
