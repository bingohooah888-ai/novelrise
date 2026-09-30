import { URL } from 'node:url';

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

const TEMPLATE_URL = new URL('../../episode.html', import.meta.url);
const PLACEHOLDER = '<article id="card" class="card">読み込み中...</article>';

function isSensitive(novel) {
  return (
    novel?.content_rating === 'mature' ||
    (Array.isArray(novel?.content_warnings) &&
      novel.content_warnings.length > 0)
  );
}

function noindexPage(template, id) {
  const canonical = id
    ? canonicalUrl('episode', id)
    : 'https://novelight.jp/episode.html';
  return injectSeo(template, {
    title: 'エピソード | NOVELIGHT',
    description: 'NOVELIGHTのエピソードページです。',
    canonical,
    indexable: false
  });
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

    const { data: episode, error: episodeError } = await getSupabase()
      .from('episodes')
      .select('id,novel_id,status,episode_number,title')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();

    if (episodeError) throw episodeError;
    if (!episode) {
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    }

    const { data: novel, error: novelError } = await getSupabase()
      .from('novels')
      .select('id,title,status,content_rating,content_warnings')
      .eq('id', episode.novel_id)
      .eq('status', 'published')
      .maybeSingle();

    if (novelError) throw novelError;
    if (!novel) {
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    }

    const sensitive = isSensitive(novel);
    let content = '';
    if (!sensitive) {
      const { data: contentRow, error: contentError } = await getSupabase()
        .from('episodes')
        .select('content')
        .eq('id', episode.id)
        .eq('status', 'published')
        .maybeSingle();
      if (contentError) throw contentError;
      content = contentRow?.content || '';
    }

    const title = `${episode.title} | ${novel.title} | NOVELIGHT`;
    const description = sensitive
      ? `${episode.title} — 閲覧前に内容に関する注意をご確認ください。`
      : compactText(content) ||
        `${episode.title} — ${novel.title}のエピソードです。`;
    let html = injectSeo(template, {
      title,
      description,
      canonical: canonicalUrl('episode', episode.id)
    });

    if (!sensitive) {
      html = replacePlaceholder(
        html,
        PLACEHOLDER,
        `<article id="card" class="card"><div class="novel-title"><a href="novel.html?id=${encodeURIComponent(novel.id)}">${escapeHtml(novel.title)}</a></div><div class="number">第${escapeHtml(episode.episode_number)}話</div><h1>${escapeHtml(episode.title)}</h1><div class="content">${escapeHtml(content)}</div></article>`
      );
    }

    return sendHtml(req, res, html);
  } catch (error) {
    console.error('Episode SEO render failed', {
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
