import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { injectSeo } from '../api/seo/public-page.js';
import {
  OG_HEIGHT,
  OG_WIDTH,
  novelOgImageUrl,
  novelOgVersion,
  selectNovelOgImage
} from '../api/og/novel-data.js';

test('novel OGP image priority is author > book > common', () => {
  const author = selectNovelOgImage({
    authorImageUrl:
      'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/a/author.png',
    bookThumbnailUrl:
      'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/a/book.png'
  });
  assert.equal(author.source, 'author');
  assert.match(author.url, /author\.png$/u);

  const book = selectNovelOgImage({
    bookThumbnailUrl:
      'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/a/book.png'
  });
  assert.equal(book.source, 'book');
  assert.match(book.url, /book\.png$/u);

  assert.deepEqual(selectNovelOgImage(), { source: 'common', url: '' });
});

test('novel OGP URL is versioned and fixed at 1200x630', () => {
  const base = {
    id: 541,
    title: '作品A',
    description: 'あらすじ',
    authorName: '作者A',
    authorImageUrl: '',
    bookThumbnailUrl: ''
  };
  const versionA = novelOgVersion(base);
  const versionB = novelOgVersion({ ...base, title: '作品B' });

  assert.notEqual(versionA, versionB);
  const imageUrl = new URL(novelOgImageUrl(base.id, versionA));
  assert.equal(imageUrl.origin, 'https://novelight.jp');
  assert.equal(imageUrl.pathname, '/api/og/novel');
  assert.equal(imageUrl.searchParams.get('id'), '541');
  assert.equal(imageUrl.searchParams.get('v'), versionA);
  assert.equal(OG_WIDTH, 1200);
  assert.equal(OG_HEIGHT, 630);
});

test('injectSeo emits article Open Graph and large Twitter card in initial HTML', () => {
  const html = '<html><head><title>old</title></head><body></body></html>';
  const image = 'https://novelight.jp/api/og/novel?id=541&v=abc123';
  const result = injectSeo(html, {
    title: '作品A | NOVELIGHT',
    description: '通常説明',
    canonical: 'https://novelight.jp/novel.html?id=541',
    openGraph: {
      title: '作品A',
      description: '作品あらすじ',
      image,
      url: 'https://novelight.jp/novel.html?id=541',
      type: 'article'
    }
  });

  assert.match(result, /property="og:title" content="作品A"/u);
  assert.match(result, /property="og:description" content="作品あらすじ"/u);
  assert.match(result, /property="og:type" content="article"/u);
  assert.match(
    result,
    /property="og:url" content="https:\/\/novelight\.jp\/novel\.html\?id=541"/u
  );
  assert.match(result, /property="og:image"/u);
  assert.match(result, /name="twitter:card" content="summary_large_image"/u);
  assert.match(result, /name="twitter:title" content="作品A"/u);
  assert.match(result, /name="twitter:description" content="作品あらすじ"/u);
  assert.match(result, /name="twitter:image"/u);
});

test('X share sends only canonical URL while URL copy keeps attribution', async () => {
  const [endpoint, share, seoNovel] = await Promise.all([
    readFile(new URL('../api/og/novel.js', import.meta.url), 'utf8'),
    readFile(new URL('../novelight-public-share.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/seo/novel.js', import.meta.url), 'utf8')
  ]);

  assert.match(endpoint, /OG_COVER_WIDTH/u);
  assert.match(endpoint, /objectFit: fit/u);
  assert.match(endpoint, /width: OG_WIDTH/u);
  assert.match(endpoint, /height: OG_HEIGHT/u);

  const xHandler = share.slice(
    share.indexOf("shareX.addEventListener('click'"),
    share.indexOf('bar.appendChild(shareX)')
  );
  assert.match(xHandler, /searchParams\.set\('url', url\)/u);
  assert.doesNotMatch(xHandler, /searchParams\.set\('text'/u);
  assert.doesNotMatch(xHandler, /scoutAttributedShareUrl/u);
  assert.doesNotMatch(xHandler, /utm_/u);
  assert.match(
    share,
    /scoutAttributedShareUrl\(url, novelId, 'novelight', 'share'\)/u
  );

  assert.match(seoNovel, /novelight-public-share\.js/u);
  assert.match(seoNovel, /openGraph:/u);
});
