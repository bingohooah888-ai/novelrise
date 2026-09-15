import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const runtime = read('novelight-reading-continuity.js');
const episode = read('episode.html');
const novel = read('novel.html');
const favorites = read('favorites.html');

test('reader-facing pages load the reading continuity runtime', () => {
  for (const [path, html] of [
    ['episode.html', episode],
    ['novel.html', novel],
    ['favorites.html', favorites],
  ]) {
    assert.match(
      html,
      /<script src="novelight-reading-continuity\.js"><\/script>/,
      `${path} must load the reading continuity runtime`,
    );
  }
});

test('episode continuity keeps public reading open and exposes previous, toc, and next navigation', () => {
  assert.match(runtime, /\.eq\('status', 'published'\)/);
  assert.match(runtime, /第\$\{previous\.episode_number\}話/);
  assert.match(runtime, /作品目次/);
  assert.match(runtime, /第\$\{next\.episode_number\}話を読む/);
  assert.doesNotMatch(runtime, /login\.html\?redirect=.*episode/);
});

test('same-device progress supports partial resume without changing the valid-read ledger', () => {
  assert.match(runtime, /novelight:reading:v1:/);
  assert.match(runtime, /progressRatio/);
  assert.match(runtime, /前回の続きへ/);
  assert.match(runtime, /localStorage/);
  assert.doesNotMatch(runtime, /record_valid_read_progress/);
  assert.doesNotMatch(runtime, /valid_read_events/);
});

test('novel detail exposes a continue-reading entry point from stored progress', () => {
  assert.match(runtime, /installNovelContinue/);
  assert.match(
    runtime,
    /第\$\{rows\[index\]\.episodeNumber\}話の続きから読む/,
  );
  assert.match(
    runtime,
    /第\$\{rows\[targetIndex\]\.episodeNumber\}話から続きを読む/,
  );
  assert.match(runtime, /nlContinueReading/);
});

test('favorites becomes a bookshelf with update and unread state', () => {
  assert.match(runtime, /installFavoritesBookshelf/);
  assert.match(runtime, /更新あり・未読 \$\{target\.unread\}話/);
  assert.match(runtime, /最新話まで読了/);
  assert.match(runtime, /作品ページ/);
  assert.match(runtime, /back\.textContent = '← NOVELIGHTへ'/);
});
