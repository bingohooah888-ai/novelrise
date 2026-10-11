import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const reader = read('novelight-work-navigation.js');
const novel = read('novelight-novel-detail.js');

function extractDisplayTitle(source) {
  const helper = source.match(
    /  function tocDisplayTitle\(value, episodeNumber\) \{[\s\S]*?\n  \}/u
  );
  assert.ok(helper, 'TOC display helper must exist');
  return {
    source: helper[0],
    fn: runInNewContext(`(${helper[0].trim()})`)
  };
}

test('two TOC surfaces share the same title-only display policy', () => {
  const readerHelper = extractDisplayTitle(reader);
  const novelHelper = extractDisplayTitle(novel);
  assert.equal(readerHelper.source, novelHelper.source);
  assert.match(reader, /tocDisplayTitle\(row\.title, row\.number\)/u);
  assert.match(novel, /tocDisplayTitle\(row\.title, row\.number\)/u);
  assert.match(reader, /if \(displayTitle\) \{/u);
  assert.match(novel, /if \(displayTitle\) link\.appendChild/u);
});

test('remove only a matching episode prefix from the visible TOC label', () => {
  const title = extractDisplayTitle(reader).fn;
  const examples = [
    ['第121話　アルセラからのお礼状', 121, 'アルセラからのお礼状'],
    ['第122話 エルフの連絡手段', 122, 'エルフの連絡手段'],
    ['第123話：家族は宝物', 123, '家族は宝物'],
    ['第123話・家族は宝物', 123, '家族は宝物'],
    ['第123話「家族は宝物」', 123, '「家族は宝物」'],
    ['第123話', 123, ''],
    ['第123話　', 123, ''],
    ['第00123話　家族は宝物', 123, '家族は宝物'],
    ['第124話　別のお話', 123, '第124話　別のお話'],
    ['第123話はまだ続く', 123, '第123話はまだ続く'],
    ['プロローグ', 123, 'プロローグ'],
    ['家族は宝物', 123, '家族は宝物'],
    ['', 123, ''],
    [null, 123, '']
  ];
  for (const [input, episodeNumber, expected] of examples) {
    assert.equal(title(input, episodeNumber), expected, String(input));
  }
});
