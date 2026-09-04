(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_PATH = 'novelight-thumbnails.css';
  const SUPPORTED_PAGES = new Set(['index', 'search', 'ranking']);
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

  function mediaNode(url) {
    const media = document.createElement('div');
    media.className = 'novelight-official-thumbnail';
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    media.appendChild(image);
    return media;
  }

  function applyThumbnail(link, url) {
    if (!url || link.querySelector('.novelight-official-thumbnail')) return;
    const media = mediaNode(url);
    const placeholder = link.querySelector('.novel-cover-placeholder');
    if (placeholder) placeholder.replaceWith(media);
    else if (link.classList.contains('card') && document.body.classList.contains('novelight-page-ranking')) {
      const rank = link.querySelector('.rank');
      if (rank) rank.insertAdjacentElement('afterend', media);
      else link.prepend(media);
    } else link.prepend(media);
    link.classList.add('novelight-has-official-thumbnail');
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
      for (const row of data ?? []) {
        const linksForNovel = byId.get(String(row.id)) ?? [];
        linksForNovel.forEach((link) => applyThumbnail(link, row.thumbnail_url));
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
