import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const context = { window: {} };
runInNewContext(read('novelight-episode-title-display.js'), context);
const display = context.window.NovelightEpisodeTitleDisplay;

test('one display policy handles Japanese episode prefixes', () => {
  const examples = [
    ['第121話　アルセラからのお礼状', 121, 'アルセラからのお礼状'],
    ['第122話 エルフの連絡手段', 122, 'エルフの連絡手段'],
    ['第123話：家族は宝物', 123, '家族は宝物'],
    ['第１２３話・家族は宝物', 123, '家族は宝物'],
    ['第 123 話－家族は宝物', 123, '家族は宝物'],
    ['第123話「家族は宝物」', 123, '「家族は宝物」'],
    ['第123話', 123, ''],
    ['第00123話　家族は宝物', 123, '家族は宝物'],
    ['第124話　別のお話', 123, '第124話　別のお話'],
    ['第123話はまだ続く', 123, '第123話はまだ続く'],
    ['第123話Aパート', 123, '第123話Aパート'],
    ['第123話　次回予告は第124話', 123, '次回予告は第124話'],
    ['プロローグ', 123, 'プロローグ'],
    ['家族は宝物', 123, '家族は宝物'],
    ['', 123, ''],
    [null, 123, '']
  ];
  for (const [raw, number, wanted] of examples) {
    assert.equal(display.visibleTitle(raw, number), wanted, String(raw));
  }
});

test('show-number-off preserves the complete original episode title', () => {
  assert.equal(
    display.visibleTitle('第123話　家族は宝物', 123, false),
    '第123話　家族は宝物'
  );
  assert.equal(
    display.numberedTitle('第123話　家族は宝物', 123, false),
    '第123話　家族は宝物'
  );
});

test('single line formatted titles contain the number once', () => {
  assert.equal(
    display.numberedTitle('第121話　アルセラからのお礼状', 121),
    '第121話　アルセラからのお礼状'
  );
  assert.equal(display.numberedTitle('第121話', 121), '第121話');
  assert.equal(
    display.numberedTitle('アルセラからのお礼状', 121),
    '第121話　アルセラからのお礼状'
  );
});

test('reader and author display surfaces load the shared formatter', () => {
  const pages = [
    'novel.html',
    'episode.html',
    'episode-drafts.html',
    'episode-schedule.html',
    'episode-structure.html',
    'episode-import.html',
    'reading-history.html'
  ];
  for (const page of pages) {
    assert.match(
      read(page),
      /<script src="novelight-episode-title-display\.js"><\/script>/u,
      page
    );
  }
  for (const script of [
    'novelight-work-navigation.js',
    'novelight-novel-detail.js',
    'novelight-reading-history.js',
    'novelight-episode-number-entry-visibility.js'
  ]) {
    assert.match(
      read(script),
      /NovelightEpisodeTitleDisplay/u,
      script
    );
  }
  for (const page of [
    'novel.html',
    'episode.html',
    'episode-drafts.html',
    'episode-schedule.html',
    'episode-structure.html',
    'episode-import.html'
  ]) {
    assert.match(read(page), /NovelightEpisodeTitleDisplay/u, page);
  }
});

test('reader title metadata is attribute-safe and respects visibility', () => {
  const novel = read('novel.html');
  const numberVisibility = read(
    'novelight-episode-number-entry-visibility.js'
  );
  assert.match(novel, /data-raw-title="\$\{encodeURIComponent\(/u);
  assert.match(numberVisibility, /decodeURIComponent\(link\.dataset\.rawTitle\)/u);
  assert.match(numberVisibility, /if \(link\.textContent !== label\)/u);
  assert.match(numberVisibility, /showNumber\s*\)/u);
  assert.match(read('episode.html'), /episode\.show_episode_number !== false/u);
});

test('author title inputs and database writes remain unchanged', () => {
  const edit = read('episode-edit.html');
  const post = read('episode-post.html');
  assert.match(edit, /title:titleInput\.value\.trim\(\)/u);
  assert.match(post, /title:titleInput\.value\.trim\(\)/u);
});
