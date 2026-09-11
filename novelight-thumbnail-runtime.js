(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_PATH = 'novelight-thumbnails.css';
  const GEOMETRY_ENGINE_PATH = 'novelight-thumbnail-composer.js';
  const SURFACE_TYPES = ['cover', 'pattern', 'symbol', 'frame'];
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
  let geometryEnginePromise = null;

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

  function loadGeometryEngine() {
    if (window.NovelightThumbnailComposer?.geometry) {
      return Promise.resolve(window.NovelightThumbnailComposer.geometry);
    }
    if (geometryEnginePromise) return geometryEnginePromise;
    geometryEnginePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-novelight-geometry-engine]');
      const finish = () => {
        const geometry = window.NovelightThumbnailComposer?.geometry;
        if (geometry) resolve(geometry);
        else reject(new Error('Geometry Thumbnail Engine is unavailable'));
      };
      if (existing) {
        if (window.NovelightThumbnailComposer?.geometry) finish();
        else {
          existing.addEventListener('load', finish, { once: true });
          existing.addEventListener(
            'error',
            () => reject(new Error('Geometry Thumbnail Engine could not be loaded')),
            { once: true }
          );
        }
        return;
      }
      const script = document.createElement('script');
      script.src = GEOMETRY_ENGINE_PATH;
      script.async = true;
      script.dataset.novelightGeometryEngine = '1';
      script.addEventListener('load', finish, { once: true });
      script.addEventListener(
        'error',
        () => reject(new Error('Geometry Thumbnail Engine could not be loaded')),
        { once: true }
      );
      document.head.appendChild(script);
    });
    return geometryEnginePromise;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Thumbnail material could not be loaded'));
      image.src = url;
    });
  }

  function compositionQuad(composition) {
    return {
      top_left: {
        x: Number(composition.cover_top_left_x),
        y: Number(composition.cover_top_left_y)
      },
      top_right: {
        x: Number(composition.cover_top_right_x),
        y: Number(composition.cover_top_right_y)
      },
      bottom_right: {
        x: Number(composition.cover_bottom_right_x),
        y: Number(composition.cover_bottom_right_y)
      },
      bottom_left: {
        x: Number(composition.cover_bottom_left_x),
        y: Number(composition.cover_bottom_left_y)
      }
    };
  }

  async function drawFull(context, url, width, height) {
    if (!url) return;
    const image = await loadImage(url);
    context.drawImage(image, 0, 0, width, height);
  }

  async function renderGeometryFallback(composition) {
    if (!composition?.background_url || !composition?.base_book_url || !composition?.cover_url) {
      return null;
    }
    const width = Number(composition.canvas_width);
    const height = Number(composition.canvas_height);
    if (width !== 1086 || height !== 1448) return null;

    const geometry = await loadGeometryEngine();
    const quad = compositionQuad(composition);
    const validation = geometry.validateCoverQuad(quad, width, height);
    if (!validation.valid) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.clearRect(0, 0, width, height);

    await drawFull(context, composition.background_url, width, height);
    await drawFull(context, composition.base_book_url, width, height);
    for (const type of SURFACE_TYPES) {
      const url = composition[`${type}_url`];
      if (!url) continue;
      const image = await loadImage(url);
      geometry.drawPerspectiveImage(context, image, validation.quad);
    }

    if (composition.effect_url) {
      if (composition.effect_allow_outside_cover === true) {
        await drawFull(context, composition.effect_url, width, height);
      } else {
        context.save();
        geometry.clipToCoverQuad(context, validation.quad);
        await drawFull(context, composition.effect_url, width, height);
        context.restore();
      }
    }

    return canvas.toDataURL('image/webp', 0.9);
  }

  async function applyComposition(links, composition) {
    if (!links.length) return;
    if (composition?.render_url) {
      links.forEach((link) => applyCachedThumbnail(link, composition.render_url));
      return;
    }
    const renderedUrl = await renderGeometryFallback(composition);
    if (!renderedUrl) return;
    links.forEach((link) => applyCachedThumbnail(link, renderedUrl));
  }

  async function loadCompositions(browserClient, ids) {
    if (!ids.length) return [];
    const result = await browserClient.rpc('novelight_thumbnail_compositions_v2', {
      p_novel_ids: ids
    });
    if (result.error) {
      if (['42883', '42P01', '42703'].includes(result.error.code)) return [];
      throw result.error;
    }
    return result.data ?? [];
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
      await Promise.all(
        compositions.map(async (composition) => {
          const linksForNovel = byId.get(String(composition.novel_id)) ?? [];
          try {
            await applyComposition(linksForNovel, composition);
          } catch (error) {
            console.error('official thumbnail geometry fallback failed', error);
          }
        })
      );
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
