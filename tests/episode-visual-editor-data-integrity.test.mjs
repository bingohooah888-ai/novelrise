import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const visualPath = 'novelight-episode-visual-editor.js';
const imagePath = 'novelight-episode-illustrations.js';
const visual = readFileSync(visualPath, 'utf8');
const illustrations = readFileSync(imagePath, 'utf8');
const start = visual.indexOf('  const normalize = ');
const end = visual.indexOf('\n  function apiClient()', start);
assert.ok(start >= 0 && end > start);
const source = visual.slice(start, end);
const expression = source + '\n({ spliceSource, insertSourceMarker })';
const ops = runInNewContext(expression);
const spliceSource = ops.spliceSource;
const insertSourceMarker = ops.insertSourceMarker;
const prefix = '[[NOVELIGHT_ILLUSTRATION:';
const marker = prefix + '12345678-1234-4234-8234-123456789abc]]';
const older = prefix + 'abcdefab-1234-4234-8234-123456789abc]]';

test('complete paste keeps existing empty lines', () => {
  const old = '旧本文\n\n変更前';
  const pasted = '一行目\n\n二行目\n' + older + '\n\n終わり\n';
  const result = spliceSource(old, 0, old.length, pasted);
  assert.equal(result.content, pasted);
  assert.equal(result.caret, pasted.length);
});

test('Windows line endings remain single LF', () => {
  const windows = 'A\r\n\r\nB\rC\r\nD';
  const result = spliceSource('旧本文', 0, 3, windows);
  assert.equal(result.content, 'A\n\nB\nC\nD');
  const many = Array(300).fill('段落').join('\n\n');
  assert.equal(spliceSource('', 0, 0, many).content, many);
});

test('insertion at both line boundaries is exact', () => {
  const original = '一行目\n次の行';
  const expected = '一行目\n' + marker + '\n次の行';
  const left = insertSourceMarker(original, 3, 3, marker);
  const right = insertSourceMarker(original, 4, 4, marker);
  assert.equal(left.content, expected);
  assert.equal(right.content, expected);
  assert.equal(insertSourceMarker('', 0, 0, marker).content, marker);
});

test('existing image references survive a second insertion', () => {
  const original = '冒頭\n\n' + older + '\n\n結末';
  const at = original.indexOf('結末');
  const result = insertSourceMarker(original, at, at, marker);
  const expected = '冒頭\n\n' + older + '\n\n' + marker + '\n結末';
  assert.equal(result.content, expected);
});

test('paste and Enter commit plaintext before redrawing', () => {
  const paste = 'replaceSourceSelection(event.clipboardData';
  const enter = "replaceSourceSelection('\\n')";
  assert.ok(visual.includes(paste));
  assert.ok(visual.includes(enter));
  assert.ok(visual.includes('textarea.value = change.content'));
  assert.ok(visual.includes('renderSource(change.content)'));
});

test('image refresh never rebuilds editor text', () => {
  const call = 'visualEditor.insertMarker?.(marker)';
  assert.ok(illustrations.includes(call));
  assert.ok(visual.includes('insertMarker: insertVisualMarker'));
  const tail = visual.split('async function refreshFromTextarea()')[1];
  const refresh = tail.split('function scheduleRefresh()')[0];
  assert.ok(refresh.includes("figure.querySelector('img')"));
  assert.equal(refresh.includes('renderSource('), false);
});
