import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const visual = readFileSync(resolve('novelight-episode-visual-editor.js'), 'utf8');
const illustrations = readFileSync(resolve('novelight-episode-illustrations.js'), 'utf8');

// Execute the real source manipulation functions without DOM or network.
// These functions are intentionally pure, so regressions fail before any deploy.
const start = visual.indexOf('  const normalize = ');
const end = visual.indexOf('\n  function apiClient()', start);
assert.ok(start >= 0 && end > start, 'source editing helpers must exist');
const { spliceSource, insertSourceMarker } = runInNewContext(
  visual.slice(start, end) + '\n({ spliceSource, insertSourceMarker })'
);

const marker = '[[NOVELIGHT_ILLUSTRATION:12345678-1234-4234-8234-123456789abc]]';
const earlier = '[[NOVELIGHT_ILLUSTRATION:abcdefab-1234-4234-8234-123456789abc]]';

test('whole-text paste preserves exactly the pasted paragraph breaks, even with illustration markers', () => {
  const pasted = '一行目\n\n二行目\n' + earlier + '\n\n終わり\n';
  const result = spliceSource('旧本文\n\n変更前', 0, '旧本文\n\n変更前'.length, pasted);
  assert.equal(result.content, pasted);
  assert.equal(result.caret, pasted.length);
  assert.equal((result.content.match(/\n/gu) || []).length, 6);
});

test('Windows CRLF, lone CR, and long multi-paragraph paste normalize to single LF only', () => {
  const incoming = 'A\r\n\r\nB\rC\r\nD';
  const result = spliceSource('旧本文', 0, 3, incoming);
  assert.equal(result.content, 'A\n\nB\nC\nD');
  assert.equal(result.caret, result.content.length);
  const many = Array.from({ length: 300 }, (_, index) => `第${index + 1}段落`).join('\n\n');
  assert.equal(spliceSource('', 0, 0, many).content, many);
});

test('a marker inserted inside a sentence becomes its own line, without deleting adjacent text', () => {
  const result = insertSourceMarker('前半後半', 2, 2, marker);
  assert.equal(result.content, '前半\n' + marker + '\n後半');
  assert.equal(result.caret, ('前半\n' + marker + '\n').length);
});

test('insertion at existing line boundaries does not double blank lines', () => {
  assert.equal(insertSourceMarker('一行目\n次の行', 4, 4, marker).content, '一行目\n' + marker + '\n次の行');
  assert.equal(insertSourceMarker('一行目\n次の行', 3, 3, marker).content, '一行目\n' + marker + '\n次の行');
  assert.equal(insertSourceMarker('本文', 0, 0, marker).content, marker + '\n本文');
  assert.equal(insertSourceMarker('本文', 2, 2, marker).content, '本文\n' + marker);
  assert.equal(insertSourceMarker('', 0, 0, marker).content, marker);
});

test('existing illustration IDs and intentional blank lines survive additional insertions', () => {
  const source = '冒頭\n\n' + earlier + '\n\n結末';
  const position = source.indexOf('結末');
  const result = insertSourceMarker(source, position, position, marker);
  assert.equal(result.content, '冒頭\n\n' + earlier + '\n\n' + marker + '\n結末');
  assert.ok(result.content.includes(earlier));
  assert.ok(result.content.includes(marker));
});

test('pasted content must be committed as source text before re-rendering', () => {
  assert.match(visual, /editor\.addEventListener\('paste',[\s\S]*replaceSourceSelection\(event\.clipboardData/u);
  assert.match(visual, /editor\.addEventListener\('beforeinput',[\s\S]*replaceSourceSelection\('\\n'\)/u);
  assert.match(visual, /function commitSourceChange\([\s\S]*textarea\.value = change\.content;[\s\S]*renderSource\(change\.content\)/u);
});

test('illustration insertion is synchronous; async asset refresh never overwrites prose', () => {
  assert.match(illustrations, /if \(visualActive && visualEditor\.insertMarker\?\.\(marker\)\) \{/u);
  assert.match(visual, /insertMarker: insertVisualMarker/u);
  assert.match(visual, /function insertVisualMarker\([\s\S]*commitSourceChange\(insertSourceMarker\(/u);
  const refresh = visual.slice(visual.indexOf('  async function refreshFromTextarea()'), visual.indexOf('  function scheduleRefresh()'));
  assert.doesNotMatch(refresh, /renderSource\(/u);
  assert.match(refresh, /figure\.querySelector\('img'\)/u);
  assert.match(visual, /if \(serializeEditor\(\) !== normalize\(textarea\.value\)\) \{[\s\S]*renderSource\(textarea\.value\)/u);
});
