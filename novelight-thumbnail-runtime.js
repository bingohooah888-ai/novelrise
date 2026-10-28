(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_PATH = 'novelight-thumbnails.css';
  const CUSTOM_COVER_BUCKET = 'novel-custom-covers';
  const CUSTOM_COVER_PATH = /^[0-9a-f-]{36}\/([0-9]+)\/[0-9a-f-]{36}\.(?:webp|png|jpg)$/iu;
  const CUSTOM_COVER_BATCH = 50;
  const THUMBNAIL_WIDTH = 384;
  const THUMBNAIL_QUALITY = 75;
  const ABOVE_FOLD_DESKTOP = 6;
  const ABOVE_FOLD_MOBILE = 4;
  const SUPPORTED_PAGES = new Set([
    'index',
    'search',
    'ranking',
    'recommended',
    'new-arrivals',
    'author',
    'light-seed',
    'community',
    'curation',
    'favorites',
    'series',
    'reading-history',
    'special-zone',
    'my-novels'
  ]);
  let client = null;
  let scheduled = false;

  function optimizedImageUrl(url, width = THUMBNAIL_WIDTH, quality = THUMBNAIL_QUALITY) {
    const source = String(url || '').trim();
    if (!source || source.startsWith('/_vercel/image?')) return source;

    try {
      const parsed = new URL(source, window.location.origin);
      const sameOrigin = parsed.origin === window.location.origin;
      const supabaseStorage =
        parsed.hostname === 'fiepaguycecrredwrcwx.supabase.co' &&
        parsed.pathname.startsWith('/storage/v1/object/');
      if (!sameOrigin && !supabaseStorage) return source;

      const optimizerSource = sameOrigin
        ? `${parsed.pathname}${parsed.search}`
        : parsed.href;
      return `/_vercel/image?url=${encodeURIComponent(optimizerSource)}&w=${width}&q=${quality}`;
    } catch {
      return source;
    }
  }

  function pageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function installStyles() {
    if (document.querySelector('link[data-novelight-thumbnails]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_PATH;
    link.dataset.novelightThumbnails = 'official';
    document.head.appendChild(link);
  }

  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    return client;
  }

  function novelIdFromLink(link) {
    const communityId = link.dataset.communityWork;
    if (communityId && /^\d+$/u.test(communityId)) return communityId;
    try {
      const url = new URL(link.getAttribute('href'), window.location.href);
      if (!url.pathname.endsWith('/novel.html') && !url.pathname.endsWith('novel.html')) return null;
      const id = url.searchParams.get('id');
      return id && /^\d+$/u.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function cardLinks() {
    const selector = [
      'a.novel-card[href*="novel.html?id="]',
      'a.shelf-card[href*="novel.html?id="]',
      'body.novelight-page-ranking a.card[href*="novel.html?id="]',
      'a.work-card[href*="novel.html?id="]',
      'a.book-card[href*="novel.html?id="]',
      'a.community-link[href*="novel.html?id="], a.community-link[data-community-work]',
      'a.curation-work[href*="novel.html?id="]',
      'a.zone-card[href*="novel.html?id="]',
      'a.novelight-curation-public-item[href*="novel.html?id="]'
    ].join(',');
    return Array.from(document.querySelectorAll(selector));
  }

  function priorityCount() {
    return window.matchMedia('(max-width:860px)').matches
      ? ABOVE_FOLD_MOBILE
      : ABOVE_FOLD_DESKTOP;
  }

  function setImagePriority(image, prioritized) {
    image.loading = prioritized ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.fetchPriority = prioritized ? 'high' : 'low';
  }

  function optimizeExistingImages() {
    const links = cardLinks();
    const highPriorityLimit = priorityCount();
    links.forEach((link, index) => {
      const images = link.querySelectorAll(
        '.novel-cover-image, .novelight-official-thumbnail img'
      );
      images.forEach((image) => {
        const source = image.getAttribute('src') || image.currentSrc || image.src;
        const optimized = optimizedImageUrl(source);
        if (optimized && optimized !== source) image.src = optimized;
        setImagePriority(image, index < highPriorityLimit);
        image.dataset.novelightThumbnailOptimized = '1';
      });
    });
  }

  function candidateLinks() {
    return cardLinks().filter(
      (link) =>
        link.dataset.novelightThumbnailChecked !== '1' &&
        !link.classList.contains('novelight-has-custom-cover') &&
        !link.querySelector('.novel-cover-image,.novelight-official-thumbnail img,.card-media img,.community-link img,.zone-cover:not(.zone-cover-placeholder)')
    );
  }

  function imageNode(url) {
    if (!url) return null;
    const image = document.createElement('img');
    image.src = optimizedImageUrl(url);
    image.alt = '';
    setImagePriority(image, false);
    return image;
  }

  function cachedMediaNode(url) {
    const media = document.createElement('div');
    media.className = 'novelight-official-thumbnail';
    const image = imageNode(url);
    if (image) media.appendChild(image);
    return media;
  }

  function insertMedia(link, media) {
    if (!media || link.querySelector('.novelight-official-thumbnail,.novel-cover-image')) return;
    const placeholder = link.querySelector('.novel-cover-placeholder');
    if (placeholder) placeholder.replaceWith(media);
    else if (
      link.classList.contains('card') &&
      document.body.classList.contains('novelight-page-ranking')
    ) {
      const rank = link.querySelector('.rank');
      if (rank) rank.insertAdjacentElement('afterend', media);
      else link.prepend(media);
    } else link.prepend(media);
    link.classList.add('novelight-has-official-thumbnail');
  }

  function applyCachedThumbnail(link, url) {
    if (!url) return false;
    insertMedia(link, cachedMediaNode(url));
    return true;
  }

  async function applyComposition(links, composition) {
    if (!links.length || !composition?.render_url) return false;
    links.forEach((link) => applyCachedThumbnail(link, composition.render_url));
    return true;
  }

  async function loadCompositions(browserClient, ids) {
    if (!ids.length) return [];
    let result = await browserClient.rpc('novelight_thumbnail_compositions_v3', {
      p_novel_ids: ids
    });
    if (['42883', '42P01', '42703'].includes(result.error?.code)) {
      result = await browserClient.rpc('novelight_thumbnail_compositions_v2', {
        p_novel_ids: ids
      });
      if (!result.error) {
        result.data = (result.data ?? []).map((composition) => ({
          ...composition,
          cover_quad_space: 'canvas',
          base_book_source_width: null,
          base_book_source_height: null
        }));
      }
    }
    if (result.error) {
      if (['42883', '42P01', '42703'].includes(result.error.code)) return [];
      throw result.error;
    }
    return result.data ?? [];
  }

  async function loadCustomCovers(browserClient, links) {
    const byId = new Map();
    for (const link of links) {
      const id = novelIdFromLink(link);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(link);
    }
    const ids = Array.from(byId.keys());
    if (!ids.length) return;

    // One batched public/owner-RLS lookup, never one request per work card.
    for (let i = 0; i < ids.length; i += CUSTOM_COVER_BATCH) {
      const batch = ids.slice(i, i + CUSTOM_COVER_BATCH);
      const { data, error } = await browserClient
        .from('novel_custom_covers')
        .select('novel_id,storage_path')
        .in('novel_id', batch.map(Number));
      if (error) throw error;

      for (const row of data ?? []) {
        const id = String(row.novel_id);
        const path = String(row.storage_path || '');
        const matched = CUSTOM_COVER_PATH.exec(path);
        if (!matched || matched[1] !== id) continue;
        const publicUrl = browserClient.storage
          .from(CUSTOM_COVER_BUCKET)
          .getPublicUrl(path).data?.publicUrl;
        if (!publicUrl) continue;

        for (const link of byId.get(id) || []) {
          const currentImage = link.querySelector(
            '.novel-cover-image, .novelight-official-thumbnail img, .card-media img, .zone-cover:not(.zone-cover-placeholder), .community-link img'
          );
          if (currentImage) {
            const optimized = optimizedImageUrl(publicUrl);
            const previous = currentImage.getAttribute('src') || '';
            if (previous !== optimized) {
              currentImage.addEventListener('error', () => {
                if (previous) currentImage.src = previous;
                currentImage.removeAttribute('data-novelight-custom-cover');
                link.classList.remove('novelight-has-custom-cover');
              }, { once: true });
              currentImage.src = optimized;
            }
            currentImage.dataset.novelightCustomCover = '1';
          } else if (link.querySelector('.zone-cover-placeholder')) {
            const placeholder = link.querySelector('.zone-cover-placeholder');
            const cover = imageNode(publicUrl);
            if (!cover) continue;
            cover.classList.add('zone-cover', 'novel-cover-image');
            cover.dataset.novelightCustomCover = '1';
            cover.addEventListener('error', () => {
              cover.replaceWith(placeholder);
              link.classList.remove('novelight-has-custom-cover');
            }, { once: true });
            placeholder.replaceWith(cover);
          } else {
            const media = cachedMediaNode(publicUrl);
            media.classList.add('novelight-custom-cover');
            media.querySelector('img')?.addEventListener('error', () => {
              media.remove();
              link.classList.remove('novelight-has-custom-cover');
            }, { once: true });
            insertMedia(link, media);
          }
          link.classList.add('novelight-has-custom-cover');
        }
      }
    }
  }

  async function decorate() {
    scheduled = false;
    optimizeExistingImages();
    const browserClient = getClient();
    if (!browserClient) return;

    const customLinks = cardLinks().filter(
      (link) => link.dataset.novelightCustomCoverChecked !== '1'
    );
    customLinks.forEach((link) => {
      link.dataset.novelightCustomCoverChecked = '1';
    });
    if (customLinks.length) {
      try {
        await loadCustomCovers(browserClient, customLinks);
      } catch (error) {
        // Official thumbnails remain a safe fallback when cover lookup fails.
        console.warn('custom cover lookup unavailable', error);
      }
    }

    const links = candidateLinks();
    if (!links.length) return;
    links.forEach((link) => {
      link.dataset.novelightThumbnailChecked = '1';
    });

    const byId = new Map();
    for (const link of links) {
      const id = novelIdFromLink(link);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(link);
    }
    const ids = Array.from(byId.keys());
    if (!ids.length) return;

    try {
      const { data, error } = await browserClient
        .from('novels')
        .select('id,thumbnail_url')
        .in('id', ids);
      if (error) throw error;

      const unresolved = [];
      for (const row of data ?? []) {
        const novelId = String(row.id);
        const linksForNovel = byId.get(novelId) ?? [];
        if (row.thumbnail_url) {
          linksForNovel.forEach((link) => applyCachedThumbnail(link, row.thumbnail_url));
        } else {
          unresolved.push(novelId);
        }
      }

      if (unresolved.length) {
        const compositions = await loadCompositions(browserClient, unresolved);
        await Promise.all(
          compositions.map(async (composition) => {
            const linksForNovel = byId.get(String(composition.novel_id)) ?? [];
            try {
              await applyComposition(linksForNovel, composition);
            } catch (error) {
              console.error('official cached thumbnail apply failed', error);
            }
          })
        );
      }
      optimizeExistingImages();
    } catch (error) {
      console.error('official thumbnail lookup failed', error);
    }
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => void decorate(), 0);
  }

  function start() {
    if (!SUPPORTED_PAGES.has(pageSlug())) return;
    installStyles();
    scheduleDecorate();
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
})();
