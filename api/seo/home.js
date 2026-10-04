import { URL } from 'node:url';

import {
  SITE_ORIGIN,
  escapeHtml,
  injectSeo,
  methodAllowed,
  readTemplate,
  sendHtml
} from './public-page.js';

const TEMPLATE_URL = new URL('../../index.html', import.meta.url);
const TITLE = 'NOVELIGHT（ノベライト）｜小説投稿・発掘サイト';
const DESCRIPTION =
  'NOVELIGHT（ノベライト）は、作者が小説を投稿し、読者が新しい物語を発掘できる小説投稿サイトです。ランキング・検索・LIGHT SEEDで、まだ知られていない作品との出会いを届けます。';
const CANONICAL = `${SITE_ORIGIN}/`;

function injectHomepageMetadata(html) {
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${CANONICAL}#website`,
        url: CANONICAL,
        name: 'NOVELIGHT',
        alternateName: 'ノベライト',
        description: DESCRIPTION,
        inLanguage: 'ja-JP'
      },
      {
        '@type': 'Organization',
        '@id': `${CANONICAL}#organization`,
        url: CANONICAL,
        name: 'NOVELIGHT',
        alternateName: 'ノベライト'
      }
    ]
  }).replaceAll('<', '\\u003c');

  const metadata = [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="NOVELIGHT">',
    `<meta property="og:title" content="${escapeHtml(TITLE)}">`,
    `<meta property="og:description" content="${escapeHtml(DESCRIPTION)}">`,
    `<meta property="og:url" content="${escapeHtml(CANONICAL)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(TITLE)}">`,
    `<meta name="twitter:description" content="${escapeHtml(DESCRIPTION)}">`,
    `<script type="application/ld+json">${structuredData}</script>`
  ].join('\n');

  return html.replace('</head>', `${metadata}\n</head>`);
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res)) return;

  try {
    const template = await readTemplate(TEMPLATE_URL);
    const seoHtml = injectSeo(template, {
      title: TITLE,
      description: DESCRIPTION,
      canonical: CANONICAL
    });
    return sendHtml(req, res, injectHomepageMetadata(seoHtml));
  } catch (error) {
    console.error('Homepage SEO render failed', {
      code: error?.code || null,
      message: error?.message || null
    });
    return res.status(503).send('Page temporarily unavailable');
  }
}
