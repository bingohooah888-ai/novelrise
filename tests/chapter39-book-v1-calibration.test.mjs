import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const calibrationScriptPath = 'novelight-book-v1-calibration.js';
const calibrationPagePath = 'admin-book-v1-calibration.html';
const referenceAssetPath =
  'assets/thumbnail-templates/book-v1/admin-reference.webp';

function uint24le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

test('book-v1 ADMIN calibration reference keeps the canonical 1086x1448 canvas', async () => {
  const buffer = await readFile(referenceAssetPath);
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'VP8X');

  const width = uint24le(buffer, 24) + 1;
  const height = uint24le(buffer, 27) + 1;
  assert.equal(width, 1086);
  assert.equal(height, 1448);
});

test('book-v1 calibration seed is explicit and remains ADMIN-only', async () => {
  const [script, page, composer, runtime] = await Promise.all([
    readFile(calibrationScriptPath, 'utf8'),
    readFile(calibrationPagePath, 'utf8'),
    readFile('novelight-thumbnail-composer.js', 'utf8'),
    readFile('novelight-thumbnail-runtime.js', 'utf8')
  ]);

  assert.match(script, /TEMPLATE_KEY = 'book-v1'/u);
  assert.match(script, /top_left: Object\.freeze\(\{ x: 114, y: 287 \}\)/u);
  assert.match(script, /top_right: Object\.freeze\(\{ x: 701, y: 176 \}\)/u);
  assert.match(
    script,
    /bottom_right: Object\.freeze\(\{ x: 1067, y: 946 \}\)/u
  );
  assert.match(
    script,
    /bottom_left: Object\.freeze\(\{ x: 356, y: 1147 \}\)/u
  );
  assert.match(script, /admin-reference\.webp/u);
  assert.match(page, /initial calibration seed \(未保存\)/u);
  assert.match(page, /DB上の4頂点座標だけが正式なsource of truth/u);
  assert.doesNotMatch(composer, /admin-reference\.webp/u);
  assert.doesNotMatch(runtime, /admin-reference\.webp/u);
  assert.doesNotMatch(composer, /NovelightBookV1Calibration/u);
  assert.doesNotMatch(runtime, /NovelightBookV1Calibration/u);
});

test('book-v1 calibration can edit before migration but cannot persist early', async () => {
  const page = await readFile(calibrationPagePath, 'utf8');

  assert.match(
    page,
    /function canSave\(\)\{return Boolean\(composerReady&&coverQuadReady&&template&&officialBase\)\}/u
  );
  assert.match(page, /4頂点migration適用前です。実画像上の校正は可能/u);
  assert.match(page, /saveButton\.disabled=!canSave\(\)\|\|!validQuad\(quad\)/u);
  assert.match(page, /action:'set-cover-quad'/u);
  assert.match(page, /topLeftX:quad\.top_left\.x/u);
  assert.match(page, /bottomLeftY:quad\.bottom_left\.y/u);
});

test('book-v1 calibration seed is clockwise and in canvas bounds', async () => {
  const points = [
    [114, 287],
    [701, 176],
    [1067, 946],
    [356, 1147]
  ];
  for (const [x, y] of points) {
    assert.ok(x >= 0 && x <= 1086);
    assert.ok(y >= 0 && y <= 1448);
  }

  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  assert.ok(twiceArea > 0);
  assert.equal(twiceArea / 2, 576359);
});
