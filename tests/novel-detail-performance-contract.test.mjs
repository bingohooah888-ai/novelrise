import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../novel.html', import.meta.url), 'utf8');

test('novel detail safe metadata remains gate-safe and starts with auth in parallel', () => {
  assert.match(source, /Promise\.all\(\[client\.auth\.getSession\(\),client\.from\('novels'\)\.select\('id,user_id,title,genre,ai_usage,status,content_rating,content_warnings,created_at'\)/);
  assert.doesNotMatch(source, /select\('id,user_id,title,genre,ai_usage,status,content_rating,content_warnings,created_at,description,pv'\)/);
});

test('novel detail gate runs before fetching gated display fields', () => {
  const gateIndex = source.indexOf("if(needsWarningGate()&&!warningAccepted()){showWarningGate();return}");
  const fullLoadCallIndex = source.indexOf('await loadFullNovelAndRender()', gateIndex);
  assert.ok(gateIndex >= 0);
  assert.ok(fullLoadCallIndex > gateIndex);
  assert.match(source, /continueButton'[\s\S]*rememberWarningAccepted\(\);await loadFullNovelAndRender\(\)/);
});

test('novel detail no longer re-fetches select star after the gate', () => {
  assert.doesNotMatch(source, /from\('novels'\)\.select\('\*'\)/);
  assert.match(source, /from\('novels'\)\.select\('id,description,pv'\)/);
  assert.match(source, /novel=\{\.\.\.novel,\.\.\.result\.data\}/);
});

test('ranking-independent reader features remain wired', () => {
  assert.match(source, /NovelightNovelPoll\.mount/);
  assert.match(source, /NovelightCuration\.mountNovelControl/);
  assert.match(source, /setupFavorite\(\)/);
  assert.match(source, /setupSeed\(\)/);
  assert.match(source, /novelight-reading-continuity\.js/);
  assert.match(source, /novelight-bookshelf\.js/);
});
