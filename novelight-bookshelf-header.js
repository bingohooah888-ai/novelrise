(() => {
  'use strict';

  const STYLE_ID = 'novelight-bookshelf-header-style';
  const LINK_ID = 'novelightBookshelfHeaderLink';
  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .workspace-top .nl-bookshelf-header-link{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:7px 10px;border:1px solid rgba(214,164,71,.42);border-radius:9px;color:#f6ecd4!important;-webkit-text-fill-color:#f6ecd4!important;text-decoration:none;font-size:12px;font-weight:900;white-space:nowrap;text-shadow:0 1px 8px rgba(0,0,0,.72)}
      .workspace-top .nl-bookshelf-header-link:hover{border-color:#e5c568;background:rgba(214,164,71,.12);color:#fff8e8!important;-webkit-text-fill-color:#fff8e8!important}
      .nl-bookshelf-header-label,.nl-bookshelf-header-icon{color:#f6ecd4!important;-webkit-text-fill-color:#f6ecd4!important}
      .nl-bookshelf-header-icon{font-size:16px;line-height:1}
      .nl-bookshelf-header-badge{position:absolute;top:-7px;right:-7px;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#d6a447;color:#101b28;font-size:10px;font-weight:950;box-shadow:0 0 0 2px #111b2c}
      @media(max-width:720px){.nl-bookshelf-header-label{display:none}.workspace-top .nl-bookshelf-header-link{padding:7px 9px}}
    `;
    document.head.appendChild(style);
  }

  function ensureLink() {
    const header = document.querySelector('.workspace-top');
    if (!header) return null;
    let link = document.getElementById(LINK_ID);
    if (link) return link;
    installStyles();
    link = document.createElement('a');
    link.id = LINK_ID;
    link.className = 'nl-bookshelf-header-link';
    link.href = 'favorites.html';
    link.setAttribute('aria-label', '本棚を開く');
    const icon = document.createElement('span');
    icon.className = 'nl-bookshelf-header-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▥';
    const label = document.createElement('span');
    label.className = 'nl-bookshelf-header-label';
    label.textContent = '本棚';
    const badge = document.createElement('span');
    badge.className = 'nl-bookshelf-header-badge';
    badge.hidden = true;
    link.append(icon, label, badge);
    const account = header.querySelector('.account-chip');
    header.insertBefore(link, account || null);
    return link;
  }

  function loadFavoriteUpdatesScript() {
    if (window.NovelightFavoriteUpdates) return Promise.resolve();
    const existing = document.querySelector('script[data-novelight-favorite-updates]');
    if (existing) {
      return new Promise((resolve) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', resolve, { once: true });
      });
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'novelight-favorite-updates.js';
      script.dataset.novelightFavoriteUpdates = '';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  }

  async function badgeCount(clientInstance) {
    const auth = await clientInstance.auth.getSession();
    if (auth.error) throw auth.error;
    const session = auth.data?.session || null;
    if (!session) return 0;
    const userId = session.user.id;

    const [shelfResult, progressResult] = await Promise.all([
      clientInstance
        .from('reader_bookshelf_entries')
        .select('novel_id')
        .eq('user_id', userId)
        .eq('reading_state', 'want_to_read'),
      clientInstance
        .from('reader_reading_progress')
        .select('novel_id')
        .eq('user_id', userId)
    ]);
    if (shelfResult.error) throw shelfResult.error;
    if (progressResult.error) throw progressResult.error;

    const readIds = new Set((progressResult.data || []).map((row) => String(row.novel_id)));
    const targets = new Set(
      (shelfResult.data || [])
        .map((row) => String(row.novel_id))
        .filter((id) => id && !readIds.has(id))
    );

    await loadFavoriteUpdatesScript();
    if (window.NovelightFavoriteUpdates) {
      const result = await window.NovelightFavoriteUpdates.favoriteUpdates(clientInstance, {
        initialize: false
      });
      for (const item of result.updates || []) targets.add(String(item.novelId));
    }
    return targets.size;
  }

  async function mount() {
    const link = ensureLink();
    if (!link || !window.supabase) return;
    const badge = link.querySelector('.nl-bookshelf-header-badge');
    try {
      const clientInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const count = await badgeCount(clientInstance);
      if (!badge) return;
      badge.textContent = String(count);
      badge.hidden = count === 0;
      link.setAttribute(
        'aria-label',
        count ? `本棚を開く・未確認 ${count}作品` : '本棚を開く'
      );
    } catch (error) {
      console.error('bookshelf header badge unavailable', error);
      if (badge) badge.hidden = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
  } else {
    void mount();
  }
})();
