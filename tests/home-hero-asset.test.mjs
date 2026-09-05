import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const heroPath = path.join(repoRoot, 'assets', 'novelight-home-hero.png');

test('home hero uses the supplied 2048x736 PNG asset', () => {
  const data = fs.readFileSync(heroPath);
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.readUInt32BE(16), 2048);
  assert.equal(data.readUInt32BE(20), 736);
  assert.ok(
    data.byteLength > 1_000_000,
    'hero PNG should remain the high-quality source asset',
  );
});
