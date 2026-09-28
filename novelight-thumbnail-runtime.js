(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_PATH = 'novelight-thumbnails.css';
  const COMPOSER_PATH = 'novelight-thumbnail-composer.js';
  const SUPPORTED_PAGES = new Set([
    'index',
    'search',
    'ranking',
    'recommended',
    'new-arrivals',
    'light-seed'
  ]);
  let client = null;
  let scheduled = false;
  let composerPromise = null;

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
    try {
      const url = new URL(link.getAttribute('href'), window.location.href);
      if (!url.pathname.endsWith('/novel.html') && !url.pathname.endsWith('novel.html')) return null;
      const id = url.searchParams.get('id');
      return id && /^\d+$/u.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function candidateLinks() {
    const selector = [
      'a.novel-card[href*="novel.html?id="]',
      'a.shelf-card[href*="novel.html?id="]',
      'body.novelight-page-ranking a.card[href*="novel.html?id="]'
    ].join(',');
    return Array.from(document.querySelectorAll(selector)).filter(
      (link) =>
        link.dataset.novelightThumbnailChecked !== '1' &&
        !link.querySelector('.novel-cover-image')
    );
  }

  function imageNode(url) {
    if (!url) return null;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }

  function cachedMediaNode(url, { revoke = false } = {}) {
    const media = document.createElement('div');
    media.className = 'novelight-official-thumbnail';
    const image = imageNode(url);
    if (image) {
      if (revoke) {
        const release = () => URL.revokeObjectURL(url);
        image.addEventListener('load', release, { once: true });
        image.addEventListener('error', release, { once: true });
      }
      media.appendChild(image);
    }
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

  function applyCachedThumbnail(link, url, options) {
    if (!url) return false;
    insertMedia(link, cachedMediaNode(url, options));
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

  function ensureComposer() {
    if (window.NovelightThumbnailComposer?.renderSelectionToCanvas) {
      return Promise.resolve(window.NovelightThumbnailComposer);
    }
    if (composerPromise) return composerPromise;
    composerPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-novelight-thumbnail-composer-runtime]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.NovelightThumbnailComposer), { once: true });
        existing.addEventListener('error', () => reject(new Error('Thumbnail renderer could not be loaded')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = COMPOSER_PATH;
      script.async = true;
      script.dataset.novelightThumbnailComposerRuntime = '1';
      script.addEventListener('load', () => {
        if (window.NovelightThumbnailComposer?.renderSelectionToCanvas) {
          resolve(window.NovelightThumbnailComposer);
        } else {
          reject(new Error('Thumbnail renderer is unavailable'));
        }
      }, { once: true });
      script.addEventListener('error', () => reject(new Error('Thumbnail renderer could not be loaded')), { once: true });
      document.head.appendChild(script);
    });
    return composerPromise;
  }

  function fallbackLibrary(composition) {
    const templateKey = composition.template_key;
    const template = {
      template_key: templateKey,
      label: 'runtime-fallback',
      canvas_width: Number(composition.canvas_width),
      canvas_height: Number(composition.canvas_height),
      availability_status: 'active',
      effect_allow_outside_cover: composition.effect_allow_outside_cover === true,
      cover_mask_source: 'cover_quad',
      cover_mask_revision: null,
      cover_mask_url: null,
      cover_quad_space: composition.cover_quad_space || 'canvas',
      base_book_source_width: composition.base_book_source_width ?? null,
      base_book_source_height: composition.base_book_source_height ?? null,
      cover_top_left_x: composition.cover_top_left_x,
      cover_top_left_y: composition.cover_top_left_y,
      cover_top_right_x: composition.cover_top_right_x,
      cover_top_right_y: composition.cover_top_right_y,
      cover_bottom_right_x: composition.cover_bottom_right_x,
      cover_bottom_right_y: composition.cover_bottom_right_y,
      cover_bottom_left_x: composition.cover_bottom_left_x,
      cover_bottom_left_y: composition.cover_bottom_left_y
    };
    const layerTypes = ['background', 'base_book', 'cover', 'pattern', 'symbol', 'frame', 'effect'];
    const assets = [];
    const selection = { template_key: templateKey };
    for (const type of layerTypes) {
      const url = composition[`${type}_url`];
      const id = url ? `runtime-${composition.novel_id}-${type}` : null;
      selection[`${type}_asset_id`] = id;
      if (!url) continue;
      assets.push({
        id,
        image_url: url,
        layer_type: type,
        template_key: templateKey,
        availability_status: 'active'
      });
    }
    return { library: { templates: [template], assets }, selection };
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Fallback thumbnail render failed'))),
        'image/webp',
        0.86
      );
    });
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function renderFallbackBlobUrl(composition) {
    const composer = await ensureComposer();
    const { library, selection } = fallbackLibrary(composition);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt) await wait(400);
      try {
        const canvas = document.createElement('canvas');
        await composer.renderSelectionToCanvas({ canvas, library, selection });
        return URL.createObjectURL(await canvasBlob(canvas));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Fallback thumbnail render failed');
  }

  async function applyFallbackComposition(links, composition) {
    if (!links.length || !composition || composition.render_url) return false;
    const url = await renderFallbackBlobUrl(composition);
    links.forEach((link, index) => applyCachedThumbnail(link, url, { revoke: index === links.length - 1 }));
    return true;
  }

  async function runLimited(items, limit, task) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await task(items[index]);
      }
    });
    await Promise.all(workers);
  }

  async function decorate() {
    scheduled = false;
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

    const browserClient = getClient();
    if (!browserClient) return;
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

      if (!unresolved.length) return;
      const compositions = await loadCompositions(browserClient, unresolved);
      const missingCache = [];
      for (const composition of compositions) {
        const linksForNovel = byId.get(String(composition.novel_id)) ?? [];
        if (composition.render_url) {
          await applyComposition(linksForNovel, composition);
        } else {
          missingCache.push({ links: linksForNovel, composition });
        }
      }

      await runLimited(missingCache, 2, async ({ links: linksForNovel, composition }) => {
        try {
          await applyFallbackComposition(linksForNovel, composition);
        } catch (error) {
          console.error('official thumbnail fallback render failed', {
            novelId: composition.novel_id,
            error
          });
        }
      });
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
