(() => {
  'use strict';
  const STYLE_ID = 'nl-reader-account-style';
  const HOST = 'https://fiepaguycecrredwrcwx.supabase.co';
  const KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const isHome = document.body.classList.contains('novelight-page-index');
  const isShelf = document.body.classList.contains('novelight-page-favorites');
  if (!isHome && !isShelf) return;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.nl-reader-account-bar{display:inline-flex;align-items:center;gap:8px;min-width:0}',
      '.nl-reader-nav-link{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:7px 11px;border:1px solid rgba(218,181,90,.55);border-radius:9px;color:#f5e7b8!important;font-size:13px;font-weight:800;text-decoration:none!important;white-space:nowrap}',
      '.nl-reader-nav-link:hover,.nl-reader-account-chip:hover{background:rgba(218,181,90,.14)}',
      '.nl-reader-account-chip{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:200px;padding:5px 9px;border:1px solid rgba(218,181,90,.55);border-radius:9px;color:#f5e7b8!important;text-decoration:none!important}',
      '.nl-reader-avatar{display:grid;place-items:center;width:31px;height:31px;flex:none;overflow:hidden;border-radius:50%;background:#b99543;color:#081526;font-weight:900}',
      '.nl-reader-avatar img{display:block;width:100%;height:100%;object-fit:cover}',
      '.nl-reader-name{min-width:0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:800}',
      '.nl-reader-mobile-items{display:none}',
      'body.novelight-page-favorites .nl-reader-account-bar .nl-reader-nav-link{color:#51391b!important}',
      'body.novelight-page-favorites .nl-reader-account-bar .nl-reader-account-chip{color:#51391b!important}',
      'body.novelight-page-favorites .header-inner{gap:12px;flex-wrap:wrap}',
      'body.novelight-page-favorites .nl-reader-account-bar{margin-left:auto}',
      '@media(max-width:760px){body.novelight-page-index .nl-reader-account-bar{gap:5px}body.novelight-page-index .nl-reader-account-bar .nl-reader-nav-link{display:none}body.novelight-page-index .nl-reader-account-chip{padding:4px;border:0}.nl-reader-account-chip .nl-reader-name{display:none}.nl-reader-mobile-items{display:contents}.nl-reader-account-chip{max-width:44px}body.novelight-page-favorites .header-inner{padding-inline:14px}body.novelight-page-favorites .nl-reader-nav-link{padding:6px 8px}}',
      '@media(max-width:420px){body.novelight-page-favorites .nl-reader-nav-link{font-size:11px}body.novelight-page-favorites .header-inner{gap:7px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function anchor(href, label, className) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    link.className = className;
    return link;
  }

  function installAvatar(chip, name, path, client) {
    const avatar = document.createElement('span');
    avatar.className = 'nl-reader-avatar';
    const fallback = (String(name || '読者').trim() || '読者').slice(0, 1);
    avatar.textContent = fallback;
    if (path) {
      const url = client.storage.from('author-avatars').getPublicUrl(path).data?.publicUrl;
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        image.onerror = () => { avatar.replaceChildren(); avatar.textContent = fallback; };
        avatar.replaceChildren(image);
      }
    }
    chip.appendChild(avatar);
    const text = document.createElement('span');
    text.className = 'nl-reader-name';
    text.textContent = name || 'プロフィール';
    chip.appendChild(text);
    chip.setAttribute('aria-label', 'プロフィールを編集：' + String(name || '読者'));
  }

  async function mount() {
    if (!window.supabase) return;
    const client = window.supabase.createClient(HOST, KEY);
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) return;
    const user = data.session.user;
    installStyles();
    const result = await client.from('profiles')
      .select('display_name,avatar_path').eq('id', user.id).maybeSingle();
    const name = result.error
      ? (user.user_metadata?.display_name || '読者')
      : (result.data?.display_name || '読者');
    const avatarPath = result.error ? null : result.data?.avatar_path;
    const bar = document.createElement('div');
    bar.className = 'nl-reader-account-bar';
    if (isHome) bar.appendChild(anchor('favorites.html', '本棚', 'nl-reader-nav-link'));
    const chip = anchor('profile-settings.html', '', 'nl-reader-account-chip');
    installAvatar(chip, name, avatarPath, client);
    bar.appendChild(chip);
    if (isHome) {
      const header = document.querySelector('.site-header .header-actions');
      if (header) header.insertBefore(bar, header.querySelector('.mobile-menu') || null);
      const mobileNav = header?.querySelector('.mobile-menu nav');
      if (mobileNav) {
        const group = document.createElement('span');
        group.className = 'nl-reader-mobile-items';
        group.append(anchor('favorites.html', '本棚', 'nl-reader-mobile-link'));
        group.append(anchor('profile-settings.html', 'プロフィール編集', 'nl-reader-mobile-link'));
        mobileNav.appendChild(group);
      }
    } else {
      const header = document.querySelector('header .header-inner');
      if (header) {
        bar.insertBefore(anchor('favorites.html', '本棚', 'nl-reader-nav-link'), chip);
        header.appendChild(bar);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void mount().catch(console.error), { once: true });
  } else {
    void mount().catch(console.error);
  }
})();
