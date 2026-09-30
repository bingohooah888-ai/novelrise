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

const TEMPLATE_URL = new URL('../../author.html', import.meta.url);
const PROFILE_PLACEHOLDER =
  '<section id="profile" class="profile">読み込み中...</section>';
const LIST_PLACEHOLDER = '<div id="list" class="list">読み込み中...</div>';

const AI_LABELS = {
  unspecified: 'AI未申告',
  human: '人間主体',
  ai_assisted: 'AI支援',
  ai_generated: 'AI生成主体'
};

function noindexPage(template, id) {
  const canonical = id
    ? canonicalUrl('author', id)
    : 'https://novelight.jp/author.html';
  return injectSeo(template, {
    title: '作者プロフィール | NOVELIGHT',
    description: 'NOVELIGHTの作者プロフィールページです。',
    canonical,
    indexable: false
  });
}

function novelCard(novel) {
  const mature =
    novel.content_rating === 'mature'
      ? '<span class="badge mature">内容注意</span>'
      : '';
  return `<a class="card" href="novel.html?id=${encodeURIComponent(novel.id)}"><div class="badges"><span class="badge">${escapeHtml(novel.genre || '未設定')}</span><span class="badge ai">${escapeHtml(AI_LABELS[novel.ai_usage] || 'AI未申告')}</span>${mature}</div><div class="title">${escapeHtml(novel.title)}</div><div class="desc">${escapeHtml(novel.description || '')}</div><div class="meta">👁 ${Number(novel.pv || 0).toLocaleString('ja-JP')} PV</div></a>`;
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

    const supabase = getSupabase();
    const [profileResult, novelsResult] = await Promise.all([
      supabase.rpc('novelight_public_profile', { p_user_id: id }),
      supabase
        .from('novels')
        .select('id,title,genre,description,pv,ai_usage,content_rating,status')
        .eq('user_id', id)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
    ]);

    if (profileResult.error) throw profileResult.error;
    if (novelsResult.error) throw novelsResult.error;

    const novels = novelsResult.data || [];
    if (!novels.length) {
      return sendHtml(req, res, noindexPage(template, id), {
        indexable: false
      });
    }

    const publicProfile = Array.isArray(profileResult.data)
      ? profileResult.data[0]
      : profileResult.data;
    const displayName = publicProfile?.display_name || '名前未設定';
    const bio = publicProfile?.bio || '';
    const description =
      compactText(bio) || `${displayName}さんのNOVELIGHT公開作品一覧です。`;

    let html = injectSeo(template, {
      title: `${displayName} | NOVELIGHT`,
      description,
      canonical: canonicalUrl('author', id)
    });
    html = replacePlaceholder(
      html,
      PROFILE_PLACEHOLDER,
      `<section id="profile" class="profile"><div class="name">${escapeHtml(displayName)}</div><div class="bio">${escapeHtml(bio)}</div></section>`
    );
    html = replacePlaceholder(
      html,
      LIST_PLACEHOLDER,
      `<div id="list" class="list">${novels.map(novelCard).join('')}</div>`
    );

    return sendHtml(req, res, html);
  } catch (error) {
    console.error('Author SEO render failed', {
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
