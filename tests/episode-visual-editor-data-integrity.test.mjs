import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const visual = readFileSync('novelight-episode-visual-editor.js', 'utf8');
const illustrations = readFileSync(
  'novelight-episode-illustrations.js',
  'utf8'
);
const start = visual.indexOf('  const normalize = ');
const end = visual.indexOf('\n  function apiClient()', start);
assert.ok(start >= 0 && end > start);

const code = visual.slice(start, end);
const { spliceSource, insertSourceMarker } = runInNewContext(
  code + '\n({ spliceSource, insertSourceMarker })'
);

const marker = '[[NOVELIGHT_ILLUSTRATION:' + '12345678-1234-4234-8234-123456789abc]]';
const earlier = '[[NOVELIGHT_ILLUSTRATION:' + 'abcdefab-1234-4234-8234-123456789abc]]';

test('pasting an entire body keeps its exact empty lines', () => {
  const original = '旧本文\n\n変更前';
  const pasted = '一行目\n\n二行目\n' + earlier + '\n\n終わり\n';
  const result = spliceSource(original, 0, original.length, pasted);
  assert.equal(result.content, pasted);
  assert.equal(result.caret, pasted.length);
});

test('Windows line endings and many paragraphs remain stable', () => {
  const windows = 'A\r\n\r\nB\rC\r\nD';
  const result = spliceSource('旧本文', 0, 3, windows);
  assert.equal(result.content, 'A\n\nB\nC\nD');
  const many = Array(300).fill('段落').join('\n\n');
  assert.equal(spliceSource('', 0, 0, many).content, many);
});

test('markers stay on separate lines at each insertion boundary', () => {
  const text = '一行目\n次の行';
  const expected = '一行目\n' + marker + '\n次の行';
  assert.equal(insertSourceMarker(text, 3, 3, marker).content, expected);
  assert.equal(insertSourceMarker(text, 4, 4, marker).content, expected);
  assert.equal(insertSourceMarker('本文', 0, 0, marker).content, marker + '\n本文');
  assert.equal(insertSourceMarker('', 0, 0, marker).content, marker);
});

test('placing a second marker never removes the first', () => {
  const source = '冒頭\n\n' + earlier + '\n\n結末';
  const at = source.indexOf('結末');
  const result = insertSourceMarker(source, at, at, marker);
  assert.equal(result.content, '冒頭\n\n' + earlier + '\n\n' + marker + '\n結末');
});

test('paste and Enter use source edits instead of browser HTML', () => {
  assert.ok(visual.includes('replaceSourceSelection(event.clipboardData'));
  assert.ok(visual.includes("replaceSourceSelection('\\n')"));
  assert.ok(visual.includes('textarea.value = change.content'));
  assert.ok(visual.includes('renderSource(change.content)'));
});

test('async image loading never rebuilds the author text', () => {
  assert.ok(illustrations.includes('visualEditor.insertMarker?.(marker)'));
  assert.ok(visual.includes('insertMarker: insertVisualMarker'));
  const refresh = visual.split('async function refreshFromTextarea()')[1];
  const body = refresh.split('function scheduleRefresh()')[0];
  assert.ok(body.includes("figure.querySelector('img')"));
  assert.equal(body.includes('renderSource('), false);
});
