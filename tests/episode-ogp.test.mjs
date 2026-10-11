import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { injectSeo } from '../api/seo/public-page.js';

test('episode route uses a bundled SEO template', async () => {
  const [configText, ignore, root, template] = await Promise.all([
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../.vercelignore', import.meta.url), 'utf8'),
    readFile(new URL('../episode.html', import.meta.url), 'utf8'),
    readFile(
      new URL('../api/seo/templates/episode.html', import.meta.url),
      'utf8'
    )
  ]);

  const config = JSON.parse(configText);
  assert.match(ignore, /^\/episode\.html$/mu);
  assert.equal(template, root);
  assert.equal(
    config.functions['api/seo/episode.js'].includeFiles,
    'api/seo/templates/episode.html'
  );
  assert.deepEqual(
    config.rewrites.find((route) => route.source === '/episode.html'),
    { source: '/episode.html', destination: '/api/seo/episode' }
  );
});

test('episodes reuse the novel PNG for X and Open Graph', async () => {
  const seoSource = await readFile(
    new URL('../api/seo/episode.js', import.meta.url),
    'utf8'
  );
  assert.match(seoSource, /loadNovelOgData\(novel\.id\)/u);
  assert.match(seoSource, /ensureNovelSocialCard\(ogData\)/u);
  assert.match(seoSource, /twitterImage: socialCardImage/u);
  assert.match(seoSource, /image: socialCardImage/u);
  assert.match(seoSource, /canonicalUrl\('episode', episode\.id\)/u);

  const image =
    'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/social-cards/257/0123456789abcdef.png';
  const html = injectSeo(
    '<html><head><title>old</title></head><body></body></html>',
    {
      title: '第123話　家族は宝物 | 強欲のダンジョンの作り方',
      description: '閲覧前に内容に関する注意をご確認ください。',
      canonical: 'https://novelight.jp/episode.html?id=3420',
      openGraph: {
        title: '第123話　家族は宝物 | 強欲のダンジョンの作り方',
        description: '閲覧前に内容に関する注意をご確認ください。',
        image,
        twitterImage: image,
        url: 'https://novelight.jp/episode.html?id=3420',
        type: 'article'
      }
    }
  );
  assert.ok(html.includes(`<meta property="og:image" content="${image}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${image}">`));
  assert.ok(
    html.includes('<meta name="twitter:card" content="summary_large_image">')
  );
  assert.ok(html.includes('https://novelight.jp/episode.html?id=3420'));
  assert.doesNotMatch(html, /noindex, nofollow/u);
});
