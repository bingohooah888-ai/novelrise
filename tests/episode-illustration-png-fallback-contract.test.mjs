import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { episodeIllustrationInternals } from '../api/_lib/episode-illustrations.js';

const browser = await readFile('novelight-episode-illustrations.js', 'utf8');
const {
  PATH_PATTERN,
  deliveryMimeFromExtension,
  deliveryMimeType,
  pngDimensions
} = episodeIllustrationInternals;

const ownerId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';

test('episode illustration delivery contract accepts only WebP and PNG', () => {
  assert.equal(deliveryMimeType('image/webp'), 'image/webp');
  assert.equal(deliveryMimeType('image/png'), 'image/png');
  assert.equal(deliveryMimeType('image/jpeg'), null);
  assert.equal(deliveryMimeFromExtension('webp'), 'image/webp');
  assert.equal(deliveryMimeFromExtension('png'), 'image/png');
  assert.match(`${ownerId}/123/${assetId}.webp`, PATH_PATTERN);
  assert.match(`${ownerId}/123/${assetId}.png`, PATH_PATTERN);
  assert.doesNotMatch(`${ownerId}/123/${assetId}.jpg`, PATH_PATTERN);
});

test('PNG signature and IHDR dimensions are validated', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1200, 16);
  png.writeUInt32BE(800, 20);
  assert.deepEqual(pngDimensions(png), { width: 1200, height: 800 });

  const invalid = Buffer.from(png);
  invalid[0] = 0;
  assert.throws(() => pngDimensions(invalid), /INVALID_PNG/u);
});

test('browser propagates the actual canvas Blob MIME through upload', () => {
  assert.match(
    browser,
    /const mimeType = String\(blob\.type \|\| ''\)\.toLowerCase\(\)/u
  );
  assert.match(browser, /DELIVERY_TYPES\.has\(mimeType\)/u);
  assert.match(browser, /mimeType: optimized\.mimeType/u);
  assert.match(browser, /contentType: optimized\.mimeType/u);
});

test('migration aligns private bucket, MIME/extension constraint, and service-only RPC', async () => {
  const migration = await readFile(
    'supabase/migrations/20261114121000_episode_illustration_png_delivery_consistency.sql',
    'utf8'
  );
  const postcheck = await readFile(
    'supabase/checks/20261114121000_episode_illustration_png_delivery_consistency_postcheck.sql',
    'utf8'
  );
  const rollback = await readFile(
    'supabase/rollback/20261114121000_episode_illustration_png_delivery_consistency_rollback.sql',
    'utf8'
  );
  assert.match(
    migration,
    /allowed_mime_types = array\['image\/webp', 'image\/png'\]/u
  );
  assert.match(migration, /episode_illustrations_mime_extension_check/u);
  assert.match(migration, /p_mime_type is null or p_mime_type not in/u);
  assert.match(migration, /i\.deleted_at is null/u);
  assert.match(
    postcheck,
    /has_function_privilege\('authenticated',v_fn,'EXECUTE'\)/u
  );
  assert.match(rollback, /ROLLBACK BLOCKED: PNG illustration data exists/u);
  assert.doesNotMatch(migration, /drop table public\.episode_illustrations/iu);
});

test('ZIP backup retains the actual WebP or PNG extension, MIME and content', async () => {
  const source = await readFile('novelight-author-work-export.js', 'utf8');
  const scope = { window: {} };
  runInNewContext(source, scope);
  const manifest = scope.window.NovelightAuthorWorkExport.illustrationManifest(
    17,
    false,
    [
      { id: 'a', episodeId: 7, mimeType: 'image/webp' },
      { id: 'b', episodeId: 7, mimeType: 'image/png' }
    ],
    new Date('2026-11-14T00:00:00Z')
  );
  assert.equal(manifest.assets[0].archive_path, 'illustrations/7/a.webp');
  assert.equal(manifest.assets[0].mime_type, 'image/webp');
  assert.equal(manifest.assets[1].archive_path, 'illustrations/7/b.png');
  assert.equal(manifest.assets[1].mime_type, 'image/png');
  assert.match(source, /name: illustrationFilePath\(asset\)/u);
  assert.throws(
    () =>
      scope.window.NovelightAuthorWorkExport.illustrationManifest(
        17,
        false,
        [{ id: 'c', episodeId: 7, mimeType: 'image/jpeg' }],
        null
      ),
    /illustration_export_invalid_metadata/u
  );
});

test('failure UI classifies unsupported Storage MIME without blaming connectivity', async () => {
  const source = await readFile('novelight-episode-illustrations.js', 'utf8');
  assert.match(source, /invalidmimetype/iu);
  assert.match(source, /保存先がこの画像形式を受け付けませんでした/u);
  assert.match(
    source,
    /outputWidth = Math\.max\(1, Math\.floor\(outputWidth \* 0\.8\)\)/u
  );
});
