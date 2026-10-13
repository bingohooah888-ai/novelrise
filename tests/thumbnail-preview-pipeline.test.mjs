import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildThumbnailPreviews,
  previewAssetPath,
  validateOutputLocation,
  validatePreviewSources
} from '../scripts/generate-official-thumbnail-previews.mjs';

const ID = '0c453586-60ae-4df9-8e8e-316dd65ff298';
const URL =
  'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/' +
  'novel-thumbnails/official/ecab5112-8ac7-405b-aab2-1f15e65e0619.png';
const SOURCE = Buffer.from('89504e470d0a1a0a00000000', 'hex');

function sources() {
  return {
    version: 1,
    items: [{
      id: ID,
      layerType: 'background',
      templateKey: 'book-v1',
      sourceUrl: URL,
      sourceBytes: SOURCE.length
    }]
  };
}

test('official catalog rejects duplicate assets and non-official URLs', () => {
  assert.equal(validatePreviewSources(sources()).length, 1);
  assert.equal(previewAssetPath(ID), '/assets/thumbnail-previews/v1/' + ID + '.webp');
  assert.throws(() => previewAssetPath('../secret'), /Invalid/);
  const duplicates = sources();
  duplicates.items.push({ ...duplicates.items[0] });
  assert.throws(() => validatePreviewSources(duplicates), /Duplicate/);
  for (const unsafe of [
    'https://evil.example/official/' + ID + '.png',
    'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnails/other/' + ID + '.png',
    URL + '?redirect=https://evil.example',
    URL.replace('/official/', '/official/deep/')
  ]) {
    const bad = sources();
    bad.items[0].sourceUrl = unsafe;
    assert.throws(() => validatePreviewSources(bad), /Source URL/);
  }
});

test('only designated static preview directory is writable', () => {
  const safe = '/tmp/worktree/assets/thumbnail-previews/v1';
  assert.equal(validateOutputLocation(safe), path.resolve(safe));
  assert.throws(() => validateOutputLocation('/tmp/worktree/assets/originals'), /Output/);
});

test('NLO creates preview and manifest atomically without changing the source', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'novelight-preview-'));
  const manifestPath = path.join(dir, 'sources.json');
  const outputDirectory = path.join(dir, 'assets', 'thumbnail-previews', 'v1');
  await writeFile(manifestPath, JSON.stringify(sources()));
  const inputCopy = Buffer.from(SOURCE);

  const fakeEncoder = () => ({
    metadata: async () => ({ format: 'png', width: 1024, height: 1536 }),
    resize: () => ({
      webp: () => ({ toBuffer: async () => Buffer.from('RIFFpreviewWEBP') })
    })
  });

  try {
    const built = await buildThumbnailPreviews({
      manifestPath,
      outputDirectory,
      fetchImage: async () => SOURCE,
      imageEncoder: fakeEncoder
    });
    assert.equal(built.count, 1);
    assert.equal(built.originalFilesPreserved, true);
    assert.deepEqual(SOURCE, inputCopy);
    const result = JSON.parse(await readFile(path.join(outputDirectory, 'manifest.json')));
    assert.equal(result.count, 1);
    assert.equal(result.assets[0].sourceUrl, URL);
    assert.equal(result.assets[0].previewUrl, previewAssetPath(ID));
    assert.equal(result.assets[0].previewBytes, 15);
    assert.ok(await readFile(path.join(outputDirectory, ID + '.webp')));
    await assert.rejects(
      () => buildThumbnailPreviews({
        manifestPath,
        outputDirectory,
        fetchImage: async () => SOURCE,
        imageEncoder: fakeEncoder
      }),
      /Refusing/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed conversion removes temporary files but never replaces existing assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'novelight-preview-error-'));
  const manifestPath = path.join(dir, 'sources.json');
  const outputDirectory = path.join(dir, 'assets', 'thumbnail-previews', 'v1');
  await writeFile(manifestPath, JSON.stringify(sources()));
  try {
    await assert.rejects(
      () => buildThumbnailPreviews({
        manifestPath,
        outputDirectory,
        fetchImage: async () => { throw new Error('fetch failed'); },
        imageEncoder: () => { throw new Error('must not encode'); }
      }),
      /fetch failed/
    );
    await assert.rejects(
      () => readFile(path.join(outputDirectory, 'manifest.json')),
      { code: 'ENOENT' }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('option preview is isolated from canonical render and guarded by matching original', async () => {
  const source = await readFile('novelight-thumbnail-composer.js', 'utf8');
  assert.match(source, /preview\.sourceUrl !== asset\.image_url/);
  assert.match(source, /image\.src = asset\.preview_url \|\| asset\.image_url;/);
  assert.match(source, /image\.onerror = null;/);
  assert.match(source, /const baseBookImage = await loadImage\(selected\.base_book\.image_url\)/);
  assert.match(source, /await drawAsset\(context, selected\.background/);
  assert.match(source, /await drawPerspectiveAsset\(context, selected\[type\]/);
});
