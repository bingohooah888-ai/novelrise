import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import {
  buildNovelOgElement,
  prepareNovelOgCover
} from '../api/og/novel.js';

const COVER_URL =
  'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/renders/257/test.webp';

function dummyFetch(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.length) },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  });
}

test('WebP covers are visibly painted by the OG renderer', async () => {
  const original = await sharp({
    create: {
      width: 200,
      height: 300,
      channels: 3,
      background: { r: 235, g: 33, b: 59 }
    }
  })
    .webp()
    .toBuffer();

  const prepared = await prepareNovelOgCover(
    { coverSource: 'book', coverUrl: COVER_URL },
    { fetchImage: dummyFetch(original) }
  );
  assert.match(prepared.coverUrl, /^data:image\/png;base64,/u);

  const bytes = Buffer.from(prepared.coverUrl.split(',')[1], 'base64');
  const image = sharp(bytes);
  const metadata = await image.metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 440);
  assert.equal(metadata.height, 630);

  const sample = await image
    .extract({ left: 220, top: 315, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(sample[0] > sample[1] * 3);
  assert.ok(sample[0] > sample[2] * 2);

  // Test the real OG renderer rather than only the PNG signature. Before
  // this change, WebP covers could produce an empty navy card region.
  const { ImageResponse } = await import('@vercel/og');
  const rendered = Buffer.from(
    await new ImageResponse(
      buildNovelOgElement({
        ...prepared,
        title: 'Red Cover Check',
        authorName: 'NOVELIGHT Test',
        id: 257
      }),
      { width: 1200, height: 630 }
    ).arrayBuffer()
  );
  const finalPixel = await sharp(rendered)
    .extract({ left: 220, top: 315, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(finalPixel[0] > finalPixel[1] * 3);
  assert.ok(finalPixel[0] > finalPixel[2] * 2);
});

test('broken covers never become blank cached cards', async () => {
  const source = { coverSource: 'book', coverUrl: COVER_URL };
  await assert.rejects(
    prepareNovelOgCover(source, {
      fetchImage: dummyFetch(Buffer.from('not a cover'))
    })
  );
  const failIfFetched = () => {
    throw new Error('should not fetch');
  };
  await assert.rejects(
    prepareNovelOgCover(
      { coverSource: 'book', coverUrl: 'https://example.org/cover.webp' },
      { fetchImage: failIfFetched }
    ),
    /not trusted/u
  );
});

test('missing covers retain the branded fallback', async () => {
  const source = { coverSource: 'common', coverUrl: '' };
  assert.equal(await prepareNovelOgCover(source), source);
});
