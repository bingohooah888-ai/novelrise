(() => {
  'use strict';
  if ((location.pathname.split('/').pop() || '') !== 'novel.html') return;

  const q = (selector, root = document) => root.querySelector(selector);
  const novelId = new URLSearchParams(location.search).get('id');
  if (!novelId) return;

  function waitFor(selector) {
    const hit = q(selector);
    if (hit) return Promise.resolve(hit);
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const node = q(selector);
        if (!node) return;
        observer.disconnect();
        resolve(node);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function progress() {
    try {
      return JSON.parse(localStorage.getItem(`novelight:reading:v1:${novelId}`) || 'null');
    } catch {
      return null;
    }
  }

  function episodeRows() {
    return [...document.querySelectorAll('#episodeList .episode')].map(node => {
      const link = q('a[href*="episode.html?id="]', node);
      const match = (q('.episode-number', node)?.textContent || '').match(/第\s*(\d+)\s*話/u);
      if (!link || !match) return null;
      let id = null;
      try { id = new URL(link.href, location.href).searchParams.get('id'); } catch {}
      return id ? { id, href: link.href, number: Number(match[1]) } : null;
    }).filter(Boolean);
  }

  function addReadAction(actions, rows) {
    if (q('#nlContinueReading') || !rows.length) return;
    const stored = progress();
    let index = stored ? rows.findIndex(row => String(row.id) === String(stored.episodeId)) : -1;
    let target = rows[0];
    let label = '第1話から読む';
    if (index >= 0) {
      const completed = Number(stored.progressRatio || 0) >= 0.85;
      target = completed && rows[index + 1] ? rows[index + 1] : rows[index];
      label = '続きを読む';
    }
    const link = document.createElement('a');
    link.id = 'nlContinueReading';
    link.className = 'nl-novel-read-action';
    link.href = target.href;
    link.innerHTML = `<span>${label}</span><span aria-hidden="true">→</span>`;
    actions.appendChild(link);
  }

  function optimized(url) {
    const value = String(url || '').trim();
    if (!value || value.startsWith('/_vercel/image?')) return value;
    try {
      const parsed = new URL(value, location.origin);
      const same = parsed.origin === location.origin;
      const storage = parsed.hostname === 'fiepaguycecrredwrcwx.supabase.co' && parsed.pathname.startsWith('/storage/v1/object/');
      if (!same && !storage) return value;
      const source = same ? `${parsed.pathname}${parsed.search}` : parsed.href;
      return `/_vercel/image?url=${encodeURIComponent(source)}&w=720&q=82`;
    } catch {
      return value;
    }
  }

  async function mountCover(mount) {
    if (typeof supabase === 'undefined') return;
    const db = supabase.createClient(
      'https://fiepaguycecrredwrcwx.supabase.co',
      'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
    );
    let url = '';
    try {
      const direct = await db.from('novels').select('thumbnail_url').eq('id', novelId).maybeSingle();
      url = direct.data?.thumbnail_url || '';
      if (!url) {
        let result = await db.rpc('novelight_thumbnail_compositions_v3', { p_novel_ids: [String(novelId)] });
        if (['42883', '42P01', '42703'].includes(result.error?.code)) {
          result = await db.rpc('novelight_thumbnail_compositions_v2', { p_novel_ids: [String(novelId)] });
        }
        url = Array.isArray(result.data) ? (result.data[0]?.render_url || '') : '';
      }
    } catch (error) {
      console.warn('novel detail fallback cover unavailable', error);
    }
    if (!url) return;
    const image = document.createElement('img');
    image.src = optimized(url);
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    mount.replaceChildren(image);
  }

  function loadV2() {
    if (q('script[data-nlv2-loader]')) return;
    const script = document.createElement('script');
    script.src = 'novelight-novel-detail-ui.js';
    script.dataset.nlv2Loader = '1';
    document.head.appendChild(script);
  }

  async function boot() {
    await waitFor('#favoriteButton');
    await waitFor('#episodeList a[href*="episode.html?id="]');

    if (!document.body.classList.contains('nl-novel-detail-refresh')) {
      const header = q('#novelHeader');
      const title = q('.title', header);
      const tags = q('.tags', header);
      const author = q('.author', header);
      const description = q('.description', header);
      const meta = q('.meta', header);
      const favorite = q('#favoriteButton', header);
      if (header && title && tags && author && description && meta && favorite) {
        const hero = document.createElement('div');
        hero.className = 'nl-novel-hero';
        const cover = document.createElement('div');
        cover.id = 'nlNovelDetailCover';
        cover.className = 'nl-novel-cover-shell';
        cover.innerHTML = '<div class="nl-novel-cover-placeholder">NOVELIGHT</div>';
        const main = document.createElement('div');
        main.className = 'nl-novel-main';
        const actions = document.createElement('div');
        actions.id = 'nlNovelDetailActions';
        actions.className = 'nl-novel-actions';
        actions.appendChild(favorite);
        addReadAction(actions, episodeRows());
        main.append(tags, title, author, meta, actions);
        hero.append(cover, main);
        const synopsis = document.createElement('section');
        synopsis.className = 'nl-novel-description-section';
        synopsis.append(description);
        header.replaceChildren(hero, synopsis);
        header.classList.add('nl-novel-detail');
        document.body.classList.add('nl-novel-detail-refresh');
        void mountCover(cover);
      }
    }
    loadV2();
  }

  void boot();
})();
