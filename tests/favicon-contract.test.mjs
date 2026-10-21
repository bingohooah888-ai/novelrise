import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const favicon = readFileSync(new URL('../favicon.ico', import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('NOVELIGHT serves the approved site-wide 16/32/48 favicon', () => {
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 3);

  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(favicon[entry], size);
    assert.equal(favicon[entry + 1], size);
    const bytes = favicon.readUInt32LE(entry + 8);
    const offset = favicon.readUInt32LE(entry + 12);
    assert.ok(bytes > pngSignature.length);
    assert.ok(offset + bytes <= favicon.length);
    assert.ok(favicon.subarray(offset, offset + 8).equals(pngSignature));
  }
});

test('homepage explicitly links approved favicon with a fresh URL', () => {
  const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(homepage.includes('rel="icon" type="image/x-icon" href="/favicon.ico?v=20261022"'));
});
