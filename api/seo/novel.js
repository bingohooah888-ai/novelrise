import { URL } from 'node:url';

import { loadNovelOgData } from '../og/novel-data.js';
import {
  canonicalUrl,
  compactText,
  escapeHtml,
  getSupabase,
  injectSeo,
  methodAllowed,
  queryValue,
  readTemplate,
  replacePlaceholder,
  sendHtml
} from './public-page.js';

const TEMPLATE_URL = new URL('./templates/novel.html', import.meta.url);
const PLACEHOLDER =
  '<section id="novelHeader" class="panel novel-header">読み込み中...</section>';
const SHARE_SCRIPT = '<script src="novelight-public-share.js"></script>';

function isSensitive(novel) {
  return (
    novel?.content_rating === 'mature' ||
    (Array.isArray(novel?.content_warnings) &&
      novel.content_warnings.length > 0)
  );
}

function noindexPage(template, id) {
  const canonical = id
    ? canonicalUrl('novel', id)
    : 'https://novelight.jp/novel.html';
  return injectSeo(template, {
    title: '作品詳細 | NOVELIGHT',
    description: 'NOVELIGHTの作品詳細ページです。',
    canonical,
    indexable: false
  });
}

function ensureShareScript(html) {
  if (html.includes('novelight-public-share.js')) return html;
  return html.replace('</body>', `${SHARE_SCRIPT}</body>`);
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res)) return;

  const id = queryValue(req.query?.id);

  try {
    const template = await readTemplate(TEMPLATE_URL);
    if (!id) {
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    }

    const { data: novel, error } = await getSupabase()
      .from('novels')
      .select(
        'id,title,description,genre,status,content_rating,content_warnings'
      )
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();

    if (error) throw error;
    if (!novel) {
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    }

    const sensitive = isSensitive(novel);
    const title = `${novel.title} | NOVELIGHT`;
    const description = sensitive
      ? `${novel.title} — 閲覧前に内容に関する注意をご確認ください。`
      : compactText(novel.description) ||
        `${novel.title} — NOVELIGHTで公開中の小説作品です。`;
    const ogData = await loadNovelOgData(novel.id);
    const ogDescription =
      compactText(novel.description, 220) ||
      `${novel.title} — NOVELIGHTで公開中の小説作品です。`;
    const canonical = canonicalUrl('novel', novel.id);
    let html = injectSeo(template, {
      title,
      description,
      canonical,
      openGraph: ogData
        ? {
            title: novel.title,
            description: ogDescription,
            image: ogData.imageUrl,
            url: canonical,
            type: 'article'
          }
        : null
    });

    if (!sensitive) {
      html = replacePlaceholder(
        html,
        PLACEHOLDER,
        `<section id="novelHeader" class="panel novel-header"><div class="tags"><span class="tag">${escapeHtml(novel.genre || '未設定')}</span></div><h1 class="title">${escapeHtml(novel.title)}</h1><div class="description">${escapeHtml(novel.description || '')}</div></section>`
      );
    }

    html = ensureShareScript(html);
    return sendHtml(req, res, html);
  } catch (error) {
    console.error('Novel SEO render failed', {
      code: error?.code || null,
      message: error?.message || null
    });

    try {
      const template = await readTemplate(TEMPLATE_URL);
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    } catch {
      return res.status(503).send('Page temporarily unavailable');
    }
  }
}
