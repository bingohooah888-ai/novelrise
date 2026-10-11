import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { buildNovelOgElement } from '../api/og/novel.js';
import { injectSeo } from '../api/seo/public-page.js';
import {
  OG_HEIGHT,
  OG_WIDTH,
  novelOgImageUrl,
  novelOgVersion,
  selectNovelOgImage
} from '../api/og/novel-data.js';

test('X card uses Mincho text and unchanged cover width', () => {
  const data = {
    coverSource: 'common',
    coverUrl: '',
    title: '思い出の日記',
    authorName: '福子'
  };
  const card = buildNovelOgElement(data);
  const detail = card.props.children[1];
  const [branding, title, author] = detail.props.children;
  assert.equal(card.props.style.width, '1200px');
  assert.equal(card.props.style.height, '630px');
  assert.equal(card.props.children[0].props.style.width, '440px');
  assert.equal(title.props.style.fontFamily, 'Sawarabi Mincho');
  assert.equal(title.props.style.fontSize, '70px');
  assert.equal(title.props.style.maxHeight, '270px');
  assert.equal(author.props.style.fontFamily, 'Sawarabi Mincho');
  assert.equal(author.props.style.fontSize, '30px');
  assert.equal(branding.props.children, 'NOVELIGHT ORIGINAL');

  const longer = buildNovelOgElement({
    ...data,
    title: '長い作品タイトルのサンプルです'.repeat(2)
  });
  assert.equal(
    longer.props.children[1].props.children[1].props.style.fontSize,
    '48px'
  );
});

test('Mincho layout invalidates the previous immutable card', () => {
  const source = {
    id: 549,
    title: '思い出の日記',
    authorName: '福子',
    description: '',
    authorImageUrl: '',
    bookThumbnailUrl: ''
  };
  const current = novelOgVersion(source);
  assert.notEqual(current, 'c638cfb90031bd4a');
  assert.match(current, /^[0-9a-f]{16}$/u);
});

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

test('X and Open Graph share the same versioned static PNG', async () => {
  const staticImage =
    'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/social-cards/354/0123456789abcdef.png';
  const html = injectSeo('<html><head></head><body></body></html>', {
    title: '作品354',
    description: '紹介',
    canonical: 'https://novelight.jp/novel.html?id=354',
    openGraph: {
      title: '作品354',
      description: '紹介',
      image: staticImage,
      twitterImage: staticImage
    }
  });
  assert.ok(
    html.includes(`<meta property="og:image" content="${staticImage}">`)
  );
  assert.ok(
    html.includes(`<meta name="twitter:image" content="${staticImage}">`)
  );
  assert.ok(
    html.includes('<meta name="twitter:card" content="summary_large_image">')
  );
  assert.ok(html.includes('<meta property="og:image:width" content="1200">'));
  assert.ok(html.includes('<meta property="og:image:height" content="630">'));

  const seoNovel = await readFile(
    new URL('../api/seo/novel.js', import.meta.url),
    'utf8'
  );
  assert.match(seoNovel, /ensureNovelSocialCard\(ogData\)/u);
  assert.match(seoNovel, /image: socialCardImage/u);
  assert.match(seoNovel, /twitterImage: socialCardImage/u);
});

test('X share uses cover media while URL copy keeps attribution', async () => {
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
  assert.match(xHandler, /NovelightXImageShare\.share/u);
  assert.match(xHandler, /searchParams\.set\('url', cardUrl\.href\)/u);
  assert.match(xHandler, /searchParams\.set\('x_card'/u);
  assert.match(xHandler, /searchParams\.set\('text', text\)/u);
  assert.doesNotMatch(xHandler, /scoutAttributedShareUrl/u);
  assert.doesNotMatch(xHandler, /utm_/u);
  assert.match(
    share,
    /scoutAttributedShareUrl\(url, novelId, 'novelight', 'share'\)/u
  );

  assert.match(seoNovel, /novelight-public-share\.js/u);
  assert.match(seoNovel, /novelight-x-image-share\.js/u);
  assert.match(seoNovel, /openGraph:/u);
});

test('OGP renderer stays on the pre-HarfBuzz stable release', async () => {
  const [packageJson, lockJson, vercelConfig] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(
      JSON.parse
    ),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then(
      JSON.parse
    ),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8').then(
      JSON.parse
    )
  ]);

  assert.equal(packageJson.dependencies?.['@vercel/og'], '0.8.5');
  assert.equal(
    lockJson.packages?.['node_modules/@vercel/og']?.version,
    '0.8.5'
  );
  assert.equal(lockJson.packages?.['node_modules/harfbuzzjs'], undefined);
  assert.equal(vercelConfig.functions?.['api/og/novel.js'], undefined);
});

test('Vercel excludes the static novel shell so the SEO rewrite can run', async () => {
  const [seoNovel, vercelConfig, vercelIgnore, rootTemplate, serverTemplate] =
    await Promise.all([
      readFile(new URL('../api/seo/novel.js', import.meta.url), 'utf8'),
      readFile(new URL('../vercel.json', import.meta.url), 'utf8').then(
        JSON.parse
      ),
      readFile(new URL('../.vercelignore', import.meta.url), 'utf8'),
      readFile(new URL('../novel.html', import.meta.url), 'utf8'),
      readFile(
        new URL('../api/seo/templates/novel.html', import.meta.url),
        'utf8'
      )
    ]);

  assert.match(
    seoNovel,
    /new URL\('\.\/templates\/novel\.html', import\.meta\.url\)/
  );
  assert.equal(
    vercelConfig.functions?.['api/seo/novel.js']?.includeFiles,
    'api/seo/templates/novel.html'
  );
  assert.match(vercelIgnore, /^\/novel\.html$/mu);
  assert.equal(serverTemplate, rootTemplate);
});

test('only published X revision work HTML opts in to short CDN cache', async () => {
  const { sendHtml } = await import('../api/seo/public-page.js');
  const responses = [];
  const makeRes = () => {
    const headers = new Map();
    const res = {
      headers,
      setHeader: (key, value) => headers.set(key, value),
      status: () => res,
      send: (body) => {
        responses.push(body);
        return body;
      }
    };
    return res;
  };
  const normal = makeRes();
  sendHtml({ method: 'GET' }, normal, '<html></html>');
  assert.equal(normal.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(normal.headers.get('Vercel-CDN-Cache-Control'), 'no-store');

  const share = makeRes();
  sendHtml({ method: 'GET' }, share, '<html></html>', {
    socialCardCacheSeconds: 30
  });
  assert.equal(
    share.headers.get('Vercel-CDN-Cache-Control'),
    's-maxage=30'
  );
  assert.equal(share.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');

  const hidden = makeRes();
  sendHtml({ method: 'GET' }, hidden, '<html></html>', {
    indexable: false,
    socialCardCacheSeconds: 30
  });
  assert.equal(hidden.headers.get('Vercel-CDN-Cache-Control'), 'no-store');
  const head = makeRes();
  sendHtml({ method: 'HEAD' }, head, '<html></html>', {
    socialCardCacheSeconds: 30
  });
  assert.equal(head.headers.get('Vercel-CDN-Cache-Control'), 'no-store');

  const [route, config] = await Promise.all([
    readFile(new URL('../api/seo/novel.js', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  ]);
  assert.match(route, /queryValue\(req\.query\?\.x_card\) === 'png-v5-mincho'/u);
  assert.doesNotMatch(JSON.parse(config).headers.map((h) => h.source), /novel\.html/u);
  assert.ok(
    JSON.parse(config).headers.some((entry) => entry.source === '/episode.html')
  );
});
