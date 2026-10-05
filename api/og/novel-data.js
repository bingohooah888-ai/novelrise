import { createHash } from 'node:crypto';
import { URL } from 'node:url';

import {
  SITE_ORIGIN,
  canonicalUrl,
  compactText,
  getSupabase
} from '../seo/public-page.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_COVER_WIDTH = 440;
export const COMMON_OG_VERSION = 'novelight-common-v1';

const IMAGE_HOSTS = new Set([
  'fiepaguycecrredwrcwx.supabase.co',
  'novelight.jp'
]);

export function safeOgImageUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function selectNovelOgImage({
  authorImageUrl = '',
  bookThumbnailUrl = ''
} = {}) {
  const author = safeOgImageUrl(authorImageUrl);
  if (author) return { source: 'author', url: author };

  const book = safeOgImageUrl(bookThumbnailUrl);
  if (book) return { source: 'book', url: book };

  return { source: 'common', url: '' };
}

export function novelOgVersion({
  id,
  title,
  description,
  authorName,
  authorImageUrl,
  bookThumbnailUrl
}) {
  return createHash('sha256')
    .update(
      [
        COMMON_OG_VERSION,
        String(id || ''),
        String(title || ''),
        String(description || ''),
        String(authorName || ''),
        String(authorImageUrl || ''),
        String(bookThumbnailUrl || '')
      ].join('\n')
    )
    .digest('hex')
    .slice(0, 16);
}

export function novelOgImageUrl(id, version) {
  const url = new URL('/api/og/novel', SITE_ORIGIN);
  url.searchParams.set('id', String(id));
  url.searchParams.set('v', String(version));
  return url.toString();
}

async function loadAuthorImage(client, thumbnailAssetId) {
  if (!thumbnailAssetId) return '';
  const { data, error } = await client
    .from('novel_thumbnail_assets')
    .select('image_url')
    .eq('id', thumbnailAssetId)
    .maybeSingle();
  if (error) {
    console.warn('Novel OGP author image lookup failed', {
      code: error.code || null
    });
    return '';
  }
  return safeOgImageUrl(data?.image_url);
}

async function loadAuthorName(client, userId) {
  if (!userId) return '作者未設定';
  const { data, error } = await client.rpc('novelight_public_profile', {
    p_user_id: userId
  });
  if (error) {
    console.warn('Novel OGP author profile lookup failed', {
      code: error.code || null
    });
    return '作者未設定';
  }
  const row = Array.isArray(data) ? data[0] : data;
  return compactText(row?.display_name, 40) || '作者未設定';
}

async function loadBookThumbnail(client, novelId, storedThumbnailUrl) {
  const stored = safeOgImageUrl(storedThumbnailUrl);
  if (stored) return stored;

  let result = await client.rpc('novelight_thumbnail_compositions_v3', {
    p_novel_ids: [Number(novelId)]
  });
  if (result.error) {
    result = await client.rpc('novelight_thumbnail_compositions_v2', {
      p_novel_ids: [Number(novelId)]
    });
  }
  if (result.error) {
    console.warn('Novel OGP book thumbnail lookup failed', {
      code: result.error.code || null
    });
    return '';
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  return safeOgImageUrl(row?.render_url);
}

export async function loadNovelOgData(id) {
  if (!/^\d+$/u.test(String(id || ''))) return null;

  const client = getSupabase();
  const { data: novel, error } = await client
    .from('novels')
    .select(
      'id,user_id,title,description,status,thumbnail_asset_id,thumbnail_url'
    )
    .eq('id', Number(id))
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw error;
  if (!novel) return null;

  const [authorImageUrl, authorName, bookThumbnailUrl] = await Promise.all([
    loadAuthorImage(client, novel.thumbnail_asset_id),
    loadAuthorName(client, novel.user_id),
    loadBookThumbnail(client, novel.id, novel.thumbnail_url)
  ]);

  const description =
    compactText(novel.description, 222) ||
    `${novel.title} — NOVELIGHTで公開中の小説作品です。`;
  const image = selectNovelOgImage({
    authorImageUrl,
    bookThumbnailUrl
  });
  const version = novelOgVersion({
    id: novel.id,
    title: novel.title,
    description,
    authorName,
    authorImageUrl,
    bookThumbnailUrl
  });

  return {
    id: novel.id,
    title: compactText(novel.title, 100) || '無題',
    description,
    authorName,
    canonical: canonicalUrl('novel', novel.id),
    authorImageUrl,
    bookThumbnailUrl,
    coverSource: image.source,
    coverUrl: image.url,
    version,
    imageUrl: novelOgImageUrl(novel.id, version)
  };
}
