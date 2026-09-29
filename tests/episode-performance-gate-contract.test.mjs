import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../episode.html', import.meta.url), 'utf8');

test('episode auth and safe metadata load in parallel without body content', () => {
  assert.match(source, /Promise\.all\(\[client\.auth\.getSession\(\),client\.from\('episodes'\)\.select\('id,novel_id,user_id,status,episode_number,title'\)/);
  const safeQuery = source.indexOf("select('id,novel_id,user_id,status,episode_number,title')");
  const gateCheck = source.indexOf('novelNeedsGate()');
  const bodyQuery = source.indexOf("select('novel_id,content,pv')");
  assert.ok(safeQuery >= 0);
  assert.ok(gateCheck > safeQuery);
  assert.ok(bodyQuery > gateCheck);
});

test('sensitive episode body is only fetched after gate decision', () => {
  assert.match(source, /if\(!isAuthor&&novelNeedsGate\(\)&&!warningAccepted\(\)\)\{showGate\(\);return\}await loadEpisodeContentAndRender\(\)/);
  assert.match(source, /continue'\)\.onclick=async\(\)=>[\s\S]*rememberWarningAccepted\(\);await loadEpisodeContentAndRender\(\)/);
});

test('post-gate episode fetch only requests missing body fields and reuses safe metadata', () => {
  assert.match(source, /select\('novel_id,content,pv'\)/);
  assert.doesNotMatch(source, /select\('id,novel_id,user_id,episode_number,title,content,status,pv'\)/);
  assert.match(source, /episode=Object\.assign\(\{\},episode,er\.data\)/);
});

test('reader behavior remains wired after the optimized fetch path', () => {
  assert.match(source, /NovelightComments\.mount/);
  assert.match(source, /NovelightCharacters\.mountReader/);
  assert.match(source, /NovelightEpisodeHeart\.mount/);
  assert.match(source, /NovelightEpisodeIllustrations\.mountReader/);
  assert.match(source, /novelight-reading-continuity\.js/);
  assert.match(source, /record_valid_read_progress/);
});
