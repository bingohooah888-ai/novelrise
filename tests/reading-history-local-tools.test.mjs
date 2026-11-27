import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('novelight-reading-history.js', 'utf8');
const context = {};
vm.runInNewContext(source, context);
const { filterHistory, groupHistory } = context.NovelightReadingHistory;
const rows = [
  {
    novel_id: 1,
    episode_id: 900,
    episode_number: 2,
    novel_title: 'ＡＢＣ',
    episode_title: '序章',
    genre: '幻想'
  },
  {
    novel_id: 1,
    episode_id: 100,
    episode_number: 7,
    novel_title: 'ＡＢＣ',
    episode_title: '旅',
    genre: '幻想'
  },
  {
    novel_id: 2,
    episode_id: 300,
    episode_number: 3,
    novel_title: '別の作品',
    episode_title: '旅',
    genre: '恋愛'
  }
];

test('history search only filters received titles and genres', () => {
  assert.equal(filterHistory(rows, 'abc').length, 2);
  assert.equal(filterHistory(rows, '旅', '恋愛').length, 1);
  assert.equal(filterHistory(rows, 'x'.repeat(121)).length, 0);
  assert.equal(filterHistory(null, '').length, 0);
});

test('work history groups by work ID and uses episode ordinals', () => {
  const before = JSON.stringify(rows);
  const result = groupHistory([...rows, rows[0], { novel_id: 3 }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].number, 7);
  assert.equal(result[0].latest.episode_id, 100);
  assert.equal(result[0].count, 2);
  assert.equal(JSON.stringify(rows), before);
  assert.match(
    source,
    /最後に読んだ位置・連続読了・未読話の判定ではありません/u
  );
});
