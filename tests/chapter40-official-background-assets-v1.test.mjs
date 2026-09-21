import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const manifest = JSON.parse(
  await readFile(
    new URL('../novelight-thumbnail-background-v1.json', import.meta.url),
    'utf8'
  )
);

test('official background manifest locks 20 approved assets', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packKey, 'NOVELIGHT_background_official_v1_20');
  assert.equal(manifest.templateKey, 'book-v1');
  assert.equal(manifest.expectedPngCount, 20);
  assert.equal(manifest.items.length, 20);
  assert.equal(new Set(manifest.items.map((item) => item.key)).size, 20);
  assert.equal(new Set(manifest.items.map((item) => item.path)).size, 20);

  for (const item of manifest.items) {
    assert.equal(item.sourceCategory, 'background');
    assert.equal(item.layerType, 'background');
    assert.equal(item.templateKey, 'book-v1');
    assert.equal(item.width, 1024);
    assert.equal(item.height, 1536);
    assert.equal(item.bitDepth, 8);
    assert.equal(item.colorType, 2);
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.match(item.path, /^images\/background_[a-z0-9_]+\.png$/);
  }
});

test('batch importer recognizes the approved background ZIP', async () => {
  const module = await readFile(
    new URL('../novelight-thumbnail-batch-import.js', import.meta.url),
    'utf8'
  );
  const html = await readFile(
    new URL('../admin-thumbnail-batch.html', import.meta.url),
    'utf8'
  );

  assert.match(module, /NOVELIGHT_background_official_v1\.zip/);
  assert.match(module, /novelight-thumbnail-background-v1\.json/);
  assert.match(module, /manifest\.expectedPngCount/);
  assert.match(module, /'background'/);
  assert.match(html, /background 20素材/);
  assert.match(html, /署名付きStorage upload/);
});
