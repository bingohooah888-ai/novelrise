import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../novel.html', import.meta.url),
  'utf8'
);

test('novel detail initial load uses safe columns and parallel safe dependencies', () => {
  assert.match(
    source,
    /Promise\.all\(\[client\.auth\.getSession\(\),client\.from\('novels'\)\.select\('id,user_id,title,genre,ai_usage,status,content_rating,content_warnings,created_at'\)/
  );
  assert.match(source, /loadWorkTags\(\)/);
});

test('novel detail never uses select star and fetches only missing display fields after the gate', () => {
  assert.doesNotMatch(source, /\.select\('\*'\)/);
  assert.match(
    source,
    /loadFullNovelAndRender\(\)[\s\S]*select\('description,pv'\)/
  );
  assert.match(source, /novel=Object\.assign\(\{\},novel,result\.data\)/);
});

test('R15 and R18 warning gate remains before the post-gate detail query', () => {
  const gate = source.indexOf(
    'if(needsWarningGate()&&!warningAccepted()){showWarningGate();return}'
  );
  const unlockCall = source.indexOf(
    'try{await loadFullNovelAndRender()}',
    gate
  );
  assert.ok(gate >= 0);
  assert.ok(unlockCall > gate);
  assert.match(source, /adult_18_nonsexual/);
  assert.match(source, /sensitive_15/);
  assert.match(
    source,
    /rememberWarningAccepted\(\);await loadFullNovelAndRender\(\)/
  );
});

test('existing novel-detail feature mounts remain wired', () => {
  assert.match(source, /NovelightSeries\.mountNovelContext/);
  assert.match(source, /NovelightNovelPoll\.mount/);
  assert.match(source, /NovelightCuration\.mountNovelControl/);
  assert.match(source, /setupFavorite\(\)/);
  assert.match(source, /setupSeed\(\)/);
  assert.match(source, /setupReceivedSeedSummary\(\)/);
  assert.match(source, /novelight-reading-continuity\.js/);
  assert.match(source, /novelight-bookshelf\.js/);
});
