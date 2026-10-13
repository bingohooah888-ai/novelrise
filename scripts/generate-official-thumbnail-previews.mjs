import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TRUSTED_ORIGIN = 'https://fiepaguycecrredwrcwx.supabase.co';
const TRUSTED_PREFIX = '/storage/v1/object/public/novel-thumbnails/official/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = new Set(['background', 'base_book', 'pattern', 'symbol', 'frame']);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 96 * 1024;
const PREVIEW_WIDTH = 192;
const PREVIEW_HEIGHT = 256;

export function previewAssetPath(id) {
  if (!UUID.test(String(id))) throw new Error('Invalid official thumbnail asset ID');
  return '/assets/thumbnail-previews/v1/' + id + '.webp';
}

export function validatePreviewSources(data) {
  if (data?.version !== 1 || !Array.isArray(data.items) || !data.items.length ||
      data.items.length > 200) {
    throw new Error('Invalid thumbnail preview source manifest');
  }
  const ids = new Set();
  const rows = [];
  for (const row of data.items) {
    if (!UUID.test(String(row.id)) || ids.has(row.id) || !TYPES.has(row.layerType)) {
      throw new Error('Duplicate or invalid official thumbnail asset');
    }
    ids.add(row.id);
    const url = new URL(row.sourceUrl);
    if (url.origin !== TRUSTED_ORIGIN || url.search || url.hash ||
        !url.pathname.startsWith(TRUSTED_PREFIX) ||
        !UUID.test(url.pathname.slice(TRUSTED_PREFIX.length).replace(/\.png$/, '')) ||
        !url.pathname.endsWith('.png')) {
      throw new Error('Source URL is not an official public thumbnail PNG');
    }
    if (!Number.isSafeInteger(row.sourceBytes) || row.sourceBytes < 1 ||
        row.sourceBytes > MAX_SOURCE_BYTES) {
      throw new Error('Unexpected official thumbnail source size');
    }
    rows.push(row);
  }
  return rows;
}

export function validateOutputLocation(output) {
  const resolved = path.resolve(output);
  if (path.basename(resolved) !== 'v1' ||
      path.basename(path.dirname(resolved)) !== 'thumbnail-previews' ||
      path.basename(path.dirname(path.dirname(resolved))) !== 'assets') {
    throw new Error('Output must be an assets/thumbnail-previews/v1 directory');
  }
  return resolved;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function downloadOriginal(url, expectedSize, signal) {
  const result = await fetch(url, {
    headers: { Accept: 'image/png' },
    redirect: 'error',
    signal
  });
  if (!result.ok) throw new Error('Official thumbnail fetch HTTP ' + result.status);
  const bytes = Buffer.from(await result.arrayBuffer());
  if (bytes.length !== expectedSize || bytes.length > MAX_SOURCE_BYTES) {
    throw new Error('Official thumbnail source size changed');
  }
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Official thumbnail is not a PNG');
  }
  return bytes;
}

export async function buildThumbnailPreviews({ manifestPath, outputDirectory, fetchImage = downloadOriginal, imageEncoder }) {
  const sources = validatePreviewSources(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  const destination = validateOutputLocation(outputDirectory);
  const exists = await fs.stat(destination).then(() => true, (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists) throw new Error('Refusing to replace an existing preview directory');

  // Keep the entire batch private until all 113 assets have passed validation.
  const temporary = destination + '.staging-' + process.pid;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(temporary, { recursive: false });
  const encoder = imageEncoder ?? (await import('sharp')).default;
  const controller = new AbortController();
  const rows = new Array(sources.length);
  let cursor = 0;
  let failed = null;
  try {
    async function worker() {
      while (cursor < sources.length && !failed) {
        const index = cursor++;
        const row = sources[index];
        try {
          const original = await fetchImage(row.sourceUrl, row.sourceBytes, controller.signal);
          const png = Buffer.from(original);
          const image = encoder(png, { limitInputPixels: 20_000_000 });
          const metadata = await image.metadata();
          if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
            throw new Error('Unexpected official thumbnail image geometry');
          }
          const preview = await encoder(png, { limitInputPixels: 20_000_000 })
            .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80, alphaQuality: 95, effort: 4 })
            .toBuffer();
          if (!preview.length || preview.length > MAX_PREVIEW_BYTES) {
            throw new Error('Generated WebP exceeded the selection-thumbnail byte budget');
          }
          await fs.writeFile(path.join(temporary, row.id + '.webp'), preview, { flag: 'wx' });
          rows[index] = {
            id: row.id,
            sourceUrl: row.sourceUrl,
            previewUrl: previewAssetPath(row.id),
            originalSha256: sha256(png),
            previewSha256: sha256(preview),
            previewBytes: preview.length
          };
        } catch (error) {
          failed = error;
          controller.abort();
        }
      }
    }

    await Promise.all(Array.from({ length: 3 }, () => worker()));
    if (failed) throw failed;
    const index = {
      version: 1,
      count: rows.length,
      assets: rows,
      totalPreviewBytes: rows.reduce((total, row) => total + row.previewBytes, 0)
    };
    await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporary, destination);
    return { count: rows.length, previewBytes: index.totalPreviewBytes, originalFilesPreserved: true };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--output') {
    throw new Error('Usage: node scripts/generate-official-thumbnail-previews.mjs --manifest <path> --output <assets/thumbnail-previews/v1>');
  }
  const result = await buildThumbnailPreviews({
    manifestPath: args[1],
    outputDirectory: args[3]
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
