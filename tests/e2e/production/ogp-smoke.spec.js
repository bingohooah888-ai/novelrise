import { expect, test } from '@playwright/test';

const PRODUCTION_NOVEL_URL = 'https://novelight.jp/novel.html?id=541';
const PRODUCTION_OG_URL = 'https://novelight.jp/api/og/novel?id=541';

function pngDimensions(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('OGP response is not a valid PNG image.');
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

test('production novel OGP is server-rendered and returns a 1200x630 PNG', async ({
  request
}) => {
  test.setTimeout(120_000);

  const novelResponse = await request.get(PRODUCTION_NOVEL_URL, {
    timeout: 20_000
  });
  expect(novelResponse.status()).toBe(200);
  expect(novelResponse.headers()['content-type'] || '').toContain('text/html');

  const html = await novelResponse.text();
  expect(html).toContain('<meta property="og:title" content="');
  expect(html).not.toContain('<meta property="og:title" content="">');
  expect(html).toContain('<meta property="og:description" content="');
  expect(html).not.toContain('<meta property="og:description" content="">');
  expect(html).toContain(
    '<meta property="og:url" content="https://novelight.jp/novel.html?id=541">'
  );
  expect(html).toContain('<meta property="og:type" content="article">');
  const ogImage = html.match(
    /<meta property="og:image" content="([^"]+)">/u
  )?.[1];
  const twitterImage = html.match(
    /<meta name="twitter:image" content="([^"]+)">/u
  )?.[1];
  expect(ogImage).toBeTruthy();
  expect(twitterImage).toBe(ogImage);
  expect(twitterImage).toMatch(
    /\/storage\/v1\/object\/public\/novel-thumbnail-renders\/social-cards\/541\/[0-9a-f]{16}\.png$/u
  );
  expect(html).toContain('<meta property="og:image:width" content="1200">');
  expect(html).toContain('<meta property="og:image:height" content="630">');
  expect(html).toContain(
    '<meta name="twitter:card" content="summary_large_image">'
  );

  const cardResponse = await request.get(twitterImage, { timeout: 30_000 });
  expect(cardResponse.status()).toBe(200);
  expect(cardResponse.headers()['content-type']).toContain('image/png');
  expect(pngDimensions(await cardResponse.body())).toEqual({
    width: 1200,
    height: 630
  });

  const headResponse = await request.head(PRODUCTION_OG_URL, {
    timeout: 30_000
  });
  expect(headResponse.status()).toBe(200);
  expect(headResponse.headers()['content-type'] || '').toContain('image/png');

  const imageResponse = await request.get(PRODUCTION_OG_URL, {
    timeout: 30_000
  });
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()['content-type'] || '').toContain('image/png');

  const image = await imageResponse.body();
  expect(pngDimensions(image)).toEqual({ width: 1200, height: 630 });
});

test('published work 354 supplies a directly fetchable X cover image', async ({
  request
}) => {
  test.setTimeout(90_000);

  const page = await request.get('https://novelight.jp/novel.html?id=354', {
    timeout: 20_000
  });
  expect(page.status()).toBe(200);
  const html = await page.text();
  const twitterImage = html.match(
    /<meta name="twitter:image" content="([^"]+)">/u
  )?.[1];
  expect(twitterImage).toBeTruthy();
  expect(twitterImage).toMatch(
    /\/storage\/v1\/object\/public\/novel-thumbnail-renders\/social-cards\/354\/[0-9a-f]{16}\.png$/u
  );

  const response = await request.get(twitterImage, { timeout: 30_000 });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
  const image = await response.body();
  expect(pngDimensions(image)).toEqual({ width: 1200, height: 630 });
  expect(image.length).toBeGreaterThan(10_000);
  expect(image.length).toBeLessThan(5 * 1024 * 1024);
});

test('episode 3420 exposes the novel PNG card', async ({ request }) => {
  test.setTimeout(90_000);

  const response = await request.get(
    'https://novelight.jp/episode.html?id=3420&x_card=episode-png-v1',
    { timeout: 30_000 }
  );
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain(
    '<meta name="twitter:card" content="summary_large_image">'
  );
  expect(html).toContain('<meta property="og:title" content="');
  expect(html).toContain(
    '<meta property="og:url" content="https://novelight.jp/episode.html?id=3420">'
  );
  expect(html).not.toContain(
    '<meta name="robots" content="noindex, nofollow">'
  );

  const ogImage = html.match(
    /<meta property="og:image" content="([^"]+)">/u
  )?.[1];
  const twitterImage = html.match(
    /<meta name="twitter:image" content="([^"]+)">/u
  )?.[1];
  expect(twitterImage).toBe(ogImage);
  expect(ogImage).toMatch(
    /\/storage\/v1\/object\/public\/novel-thumbnail-renders\/social-cards\/257\/[0-9a-f]{16}\.png$/u
  );

  const pngResponse = await request.get(ogImage, { timeout: 30_000 });
  expect(pngResponse.status()).toBe(200);
  expect(pngResponse.headers()['content-type']).toContain('image/png');
  expect(pngDimensions(await pngResponse.body())).toEqual({
    width: 1200,
    height: 630
  });
});
