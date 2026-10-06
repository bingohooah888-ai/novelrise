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
  test.setTimeout(90_000);

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
  expect(html).toContain(
    '<meta property="og:image" content="https://novelight.jp/api/og/novel?id=541&amp;v='
  );
  expect(html).toContain('<meta property="og:image:width" content="1200">');
  expect(html).toContain('<meta property="og:image:height" content="630">');
  expect(html).toContain(
    '<meta name="twitter:card" content="summary_large_image">'
  );
  expect(html).toContain(
    '<meta name="twitter:image" content="https://novelight.jp/api/og/novel?id=541&amp;v='
  );

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
