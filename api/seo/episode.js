import { URL } from 'node:url';

import { loadNovelOgData } from '../og/novel-data.js';
import { ensureNovelSocialCard } from '../og/social-card-storage.js';
import { renderEpisodeArticle } from './episode-article.js';
import {
  canonicalUrl,
  compactText,
  getSupabase,
  injectSeo,
  methodAllowed,
  queryValue,
  readTemplate,
  replacePlaceholder,
  sendHtml
} from './public-page.js';

const TEMPLATE_URL = new URL('./templates/episode.html', import.meta.url);
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
      .select('id,novel_id,status,episode_number,title,show_episode_number')
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
      .select('id,title,status,content_rating,content_warnings,show_episode_numbers')
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
    const canonical = canonicalUrl('episode', episode.id);
    const ogData = await loadNovelOgData(novel.id);
    let socialCardImage = ogData?.imageUrl || '';
    if (ogData) {
      try {
        // Share the work's published 1200x630 PNG without exposing episode
        // content in the image or generating a new asset for every chapter.
        socialCardImage = await ensureNovelSocialCard(ogData);
      } catch (error) {
        console.warn('Episode social card preparation failed', {
          episodeId: episode.id,
          code: error?.code || null,
          message: error?.message || null
        });
        // Fall back to the existing public PNG endpoint, not an empty card.
      }
    }

    let html = injectSeo(template, {
      title,
      description,
      canonical,
      openGraph: ogData
        ? {
            title: `${episode.title} | ${novel.title}`,
            description: compactText(description, 220),
            image: socialCardImage,
            twitterImage: socialCardImage,
            url: canonical,
            type: 'article'
          }
        : null
    });

    if (!sensitive) {
      html = replacePlaceholder(
        html,
        PLACEHOLDER,
        renderEpisodeArticle(episode, novel, content)
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
