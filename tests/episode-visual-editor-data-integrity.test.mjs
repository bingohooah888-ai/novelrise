import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const visual = readFileSync('novelight-episode-visual-editor.js', 'utf8');
const illustrations = readFileSync('novelight-episode-illustrations.js', 'utf8');

// Exercise the production source helpers, without requiring a browser or DB.
const start = visual.indexOf('  const normalize = ');
const end = visual.indexOf('\n  function apiClient()', start);
assert.ok(start >= 0 && end > start);
const helperSource = visual.slice(start, end);
const { spliceSource, insertSourceMarker } = runInNewContext(
  helperSource + '\n({ spliceSource, insertSourceMarker })'
);

const marker = '[[NOVELIGHT_ILLUSTRATION:12345678-1234-4234-8234-123456789abc]]';
const earlier = '[[NOVELIGHT_ILLUSTRATION:abcdefab-1234-4234-8234-123456789abc]]';

test('whole-text paste preserves blank lines and markers', () => {
  const pasted = '一行目\n\n二行目\n' + earlier + '\n\n終わり\n';
  const old = '旧本文\n\n変更前';
  const result = spliceSource(old, 0, old.length, pasted);
  assert.equal(result.content, pasted);
  assert.equal(result.caret, pasted.length);
  assert.equal((result.content.match(/\n/gu) || []).length, 6);
});

test('Windows line endings and long pasted paragraphs', () => {
  const incoming = 'A\r\n\r\nB\rC\r\nD';
  const result = spliceSource('旧本文', 0, 3, incoming);
  assert.equal(result.content, 'A\n\nB\nC\nD');
  assert.equal(result.caret, result.content.length);
  const many = Array.from(
    { length: 300 },
    (_, index) => `第${index + 1}段落`
  ).join('\n\n');
  assert.equal(spliceSource('', 0, 0, many).content, many);
});

test('inline marker insertion never removes surrounding prose', () => {
  const result = insertSourceMarker('前半後半', 2, 2, marker);
  assert.equal(result.content, '前半\n' + marker + '\n後半');
  assert.equal(result.caret, ('前半\n' + marker + '\n').length);
});

test('existing line boundaries avoid duplicate blank lines', () => {
  const source = '一行目\n次の行';
  const expected = '一行目\n' + marker + '\n次の行';
  assert.equal(insertSourceMarker(source, 4, 4, marker).content, expected);
  assert.equal(insertSourceMarker(source, 3, 3, marker).content, expected);
  assert.equal(insertSourceMarker('本文', 0, 0, marker).content, marker + '\n本文');
  assert.equal(insertSourceMarker('本文', 2, 2, marker).content, '本文\n' + marker);
  assert.equal(insertSourceMarker('', 0, 0, marker).content, marker);
});

test('previous illustrations survive new placements', () => {
  const source = '冒頭\n\n' + earlier + '\n\n結末';
  const at = source.indexOf('結末');
  const result = insertSourceMarker(source, at, at, marker);
  const expected = '冒頭\n\n' + earlier + '\n\n' + marker + '\n結末';
  assert.equal(result.content, expected);
  assert.ok(result.content.includes(earlier));
  assert.ok(result.content.includes(marker));
});

test('paste and Enter commit plain-text source before DOM projection', () => {
  assert.match(
    visual,
    /editor\.addEventListener\('paste',[\s\S]*replaceSourceSelection\(event\.clipboardData/u
  );
  assert.match(
    visual,
    /editor\.addEventListener\('beforeinput',[\s\S]*replaceSourceSelection\('\\n'\)/u
  );
  assert.match(
    visual,
    /function commitSourceChange\([\s\S]*textarea\.value = change\.content;[\s\S]*renderSource\(change\.content\)/u
  );
});

test('asset refresh cannot replace edited prose', () => {
  assert.match(
    illustrations,
    /if \(visualActive && visualEditor\.insertMarker\?\.\(marker\)\) \{/u
  );
  assert.match(visual, /insertMarker: insertVisualMarker/u);
  assert.match(
    visual,
    /function insertVisualMarker\([\s\S]*commitSourceChange\(insertSourceMarker\(/u
  );
  const refreshStart = visual.indexOf('  async function refreshFromTextarea()');
  const refreshEnd = visual.indexOf('  function scheduleRefresh()');
  const refresh = visual.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(refresh, /renderSource\(/u);
  assert.match(refresh, /figure\.querySelector\('img'\)/u);
  assert.match(
    visual,
    /if \(serializeEditor\(\) !== normalize\(textarea\.value\)\) \{[\s\S]*renderSource\(textarea\.value\)/u
  );
});
