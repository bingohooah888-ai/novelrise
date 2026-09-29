import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../episode.html', import.meta.url), 'utf8');

test('episode safe metadata and auth start in parallel without body content', () => {
  assert.match(source, /const \[auth,er\]=await Promise\.all\(\[client\.auth\.getSession\(\),client\.from\('episodes'\)\.select\('id,novel_id,user_id,status,episode_number,title,pv'\)/);
  assert.doesNotMatch(source, /select\('id,novel_id,user_id,status,episode_number,title,pv,content'/);
});

test('sensitive episode body is fetched only after warning gate decision', () => {
  const gateIndex = source.indexOf("if(!isAuthor&&novelNeedsGate()&&!warningAccepted()){showGate();return}");
  const bodyLoadCallIndex = source.indexOf('await loadEpisodeContentAndRender()', gateIndex);
  const bodyFunctionIndex = source.indexOf("async function loadEpisodeContentAndRender(){const er=await client.from('episodes').select('id,novel_id,content')");
  assert.ok(gateIndex >= 0);
  assert.ok(bodyLoadCallIndex > gateIndex);
  assert.ok(bodyFunctionIndex > gateIndex);
  assert.match(source, /document\.getElementById\('continue'\)\.onclick=[\s\S]*rememberWarningAccepted\(\);await loadEpisodeContentAndRender\(\)/);
});

test('episode body fetch requests only missing fields and reuses safe metadata', () => {
  assert.match(source, /select\('id,novel_id,content'\)/);
  assert.match(source, /episode=\{\.\.\.episode,content:er\.data\.content\}/);
  assert.doesNotMatch(source, /select\('id,novel_id,user_id,episode_number,title,content,status,pv'\)/);
});

test('reader behavior hooks remain intact', () => {
  assert.match(source, /NovelightComments\.mount/);
  assert.match(source, /NovelightEpisodeIllustrations\.mountReader/);
  assert.match(source, /record_valid_read_progress/);
  assert.match(source, /novelight-reading-continuity\.js/);
  assert.match(source, /record_novel_exposure_conversion/);
});
