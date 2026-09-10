(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_PATH = 'novelight-thumbnails.css';
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
      (link) => link.dataset.novelightThumbnailChecked !== '1'
    );
  }

  function imageNode(url, className = '') {
    if (!url) return null;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    if (className) image.className = className;
    return image;
  }

  function cachedMediaNode(url) {
    const media = document.createElement('div');
    media.className = 'novelight-official-thumbnail';
    const image = imageNode(url);
    if (image) media.appendChild(image);
    return media;
  }

  function layeredMediaNode(composition) {
    if (!composition?.background_url || !composition?.base_book_url || !composition?.cover_url) {
      return null;
    }
    const media = document.createElement('div');
    media.className = 'novelight-official-thumbnail novelight-layered-thumbnail';

    for (const [url, className] of [
      [composition.background_url, 'novelight-layer-background'],
      [composition.base_book_url, 'novelight-layer-book']
    ]) {
      const image = imageNode(url, className);
      if (image) media.appendChild(image);
    }

    const coverGroup = document.createElement('div');
    coverGroup.className = 'novelight-cover-layer-group';
    if (composition.cover_mask_url) {
      const mask = `url("${String(composition.cover_mask_url).replaceAll('"', '%22')}")`;
      coverGroup.style.maskImage = mask;
      coverGroup.style.webkitMaskImage = mask;
    }
    for (const [url, className] of [
      [composition.cover_url, 'novelight-layer-cover'],
      [composition.pattern_url, 'novelight-layer-pattern'],
      [composition.symbol_url, 'novelight-layer-symbol'],
      [composition.frame_url, 'novelight-layer-frame']
    ]) {
      const image = imageNode(url, className);
      if (image) coverGroup.appendChild(image);
    }
    media.appendChild(coverGroup);

    const effect = imageNode(composition.effect_url, 'novelight-layer-effect');
    if (effect) media.appendChild(effect);
    return media;
  }

  function insertMedia(link, media) {
    if (!media || link.querySelector('.novelight-official-thumbnail')) return;
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

  function applyComposition(link, composition) {
    if (composition?.render_url) return applyCachedThumbnail(link, composition.render_url);
    const media = layeredMediaNode(composition);
    if (!media) return false;
    insertMedia(link, media);
    return true;
  }

  async function loadCompositions(browserClient, ids) {
    if (!ids.length) return [];
    const result = await browserClient.rpc('novelight_thumbnail_compositions', {
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
        const id = String(row.id);
        const linksForNovel = byId.get(id) ?? [];
        if (row.thumbnail_url) {
          linksForNovel.forEach((link) => applyCachedThumbnail(link, row.thumbnail_url));
        } else {
          unresolved.push(id);
        }
      }

      if (!unresolved.length) return;
      const compositions = await loadCompositions(browserClient, unresolved);
      for (const composition of compositions) {
        const linksForNovel = byId.get(String(composition.novel_id)) ?? [];
        linksForNovel.forEach((link) => applyComposition(link, composition));
      }
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
