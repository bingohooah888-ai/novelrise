(() => {
  'use strict';
  const STYLE_ID = 'nl-reader-account-style';
  const HOST = 'https://fiepaguycecrredwrcwx.supabase.co';
  const KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const isHome = document.body.classList.contains('novelight-page-index');
  const isShelf = document.body.classList.contains('novelight-page-favorites');
  // Studio is a visual variant of the same reader account, not a second identity.
  const isWorkspace = Boolean(document.querySelector('.workspace-top'));
  const isPublic =
    document.body.classList.contains('novelight-public-header-page') &&
    Boolean(
      document.querySelector(
        'header.site-header .public-header-inner .header-actions'
      )
    );
  if (!isHome && !isShelf && !isWorkspace && !isPublic) return;

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
      'body.novelight-public-header-page:not(.novelight-public-dark) header.site-header .nl-reader-account-bar .nl-reader-nav-link,body.novelight-public-header-page:not(.novelight-public-dark) header.site-header .nl-reader-account-bar .nl-reader-account-chip{color:#28364a!important;-webkit-text-fill-color:#28364a!important;border-color:rgba(112,70,12,.42)}',
      'body.novelight-public-header-page:not(.novelight-public-dark) header.site-header .nl-reader-avatar{-webkit-text-fill-color:#081526!important}',
      '.workspace-top .nl-reader-account-bar{display:inline-flex;align-items:center;gap:9px;min-width:0}',
      '.workspace-top .nl-reader-account-chip{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:200px;padding:4px 7px;border:0;background:transparent;color:#f6ecd4!important;-webkit-text-fill-color:#f6ecd4!important}',
      '.workspace-top .nl-reader-account-chip:hover{background:rgba(218,181,90,.1)}',
      '.workspace-top .nl-reader-avatar{width:38px;height:38px;border:1px solid rgba(242,215,125,.78);background:linear-gradient(145deg,#0c3152,#071426 70%);color:#ffe59a}',
      '.workspace-top .nl-reader-name{max-width:132px;font-size:16px;color:#f6ecd4!important;-webkit-text-fill-color:#f6ecd4!important}',
      '@media(max-width:720px){.workspace-top .nl-reader-account-bar{gap:5px}.workspace-top .nl-reader-account-chip{padding:4px}.workspace-top .nl-reader-name{display:none}}',
      'body.novelight-page-favorites .nl-reader-account-bar .nl-reader-nav-link{color:#51391b!important}',
      'body.novelight-page-favorites .nl-reader-account-bar .nl-reader-account-chip{color:#51391b!important}',
      'body.novelight-page-favorites .header-inner{gap:12px;flex-wrap:wrap}',
      'body.novelight-page-favorites .nl-reader-account-bar{margin-left:auto}',
      '@media(max-width:760px){body.novelight-public-header-page .nl-reader-account-bar{gap:5px}body.novelight-public-header-page .nl-reader-account-bar .nl-reader-nav-link{display:none}body.novelight-public-header-page .nl-reader-account-chip{padding:4px;border:0}.nl-reader-account-chip .nl-reader-name{display:none}.nl-reader-mobile-items{display:contents}.nl-reader-account-chip{max-width:44px}body.novelight-page-favorites .header-inner{padding-inline:14px}body.novelight-page-favorites .nl-reader-nav-link{padding:6px 8px}}',
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

  function paintAvatar(avatar, name, path, client) {
    const fallback = (String(name || '読者').trim() || '読者').slice(0, 1);
    avatar.replaceChildren();
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
  }

  function installAvatar(chip, name, path, client) {
    const avatar = document.createElement('span');
    avatar.className = 'nl-reader-avatar';
    paintAvatar(avatar, name, path, client);
    chip.appendChild(avatar);
    const text = document.createElement('span');
    text.className = 'nl-reader-name';
    text.textContent = name || 'プロフィール';
    chip.appendChild(text);
    chip.setAttribute('aria-label', 'プロフィールを編集：' + String(name || '読者'));
  }

  function bookshelfLink(studio = false) {
    const link = anchor('favorites.html', '本棚', 'nl-reader-nav-link');
    if (studio) {
      link.id = 'novelightBookshelfHeaderLink';
      link.classList.add('nl-bookshelf-header-link');
      const icon = document.createElement('span');
      icon.className = 'nl-bookshelf-header-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '▥';
      const label = document.createElement('span');
      label.className = 'nl-bookshelf-header-label';
      label.textContent = '本棚';
      link.replaceChildren(icon, label);
      link.setAttribute('aria-label', '本棚を開く');
    }
    return link;
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
    if (isWorkspace) {
      const header = document.querySelector('.workspace-top');
      const account = header?.querySelector('.account-chip');
      const avatar = account?.querySelector('#accountAvatar');
      const nameNode = account?.querySelector('#accountName');
      if (!header || !account || !avatar || !nameNode) return;
      // Reuse the Author Studio nodes so profile editing and logout still work.
      account.href = 'profile-settings.html';
      account.setAttribute('aria-label', 'プロフィールを編集：' + name);
      account.classList.add('nl-reader-account-chip');
      avatar.classList.add('nl-reader-avatar');
      nameNode.classList.add('nl-reader-name');
      paintAvatar(avatar, name, avatarPath, client);
      nameNode.textContent = name;
      bar.classList.add('nl-reader-account-workspace');
      bar.append(bookshelfLink(true), account);
      header.insertBefore(bar, header.querySelector('#logout') || null);
      return;
    }
    if (isHome || isPublic) bar.appendChild(bookshelfLink());
    const chip = anchor('profile-settings.html', '', 'nl-reader-account-chip');
    installAvatar(chip, name, avatarPath, client);
    bar.appendChild(chip);
    if (isHome || isPublic) {
      const header = document.querySelector('.site-header .header-actions');
      if (header && !header.querySelector('.nl-reader-account-bar')) {
        header.insertBefore(bar, header.querySelector('.mobile-menu') || null);
      }
      const mobileNav = header?.querySelector('.mobile-menu nav');
      if (mobileNav && !mobileNav.querySelector('.nl-reader-mobile-items')) {
        const group = document.createElement('span');
        group.className = 'nl-reader-mobile-items';
        group.append(anchor('favorites.html', '本棚', 'nl-reader-mobile-link'));
        group.append(anchor('profile-settings.html', 'プロフィール編集', 'nl-reader-mobile-link'));
        mobileNav.appendChild(group);
      }
    } else {
      const header = document.querySelector('header .header-inner');
      if (header) {
        bar.insertBefore(bookshelfLink(), chip);
        header.appendChild(bar);
      }
    }
  }

  // Used by the Studio bookshelf badge to await the shared account mount.
  // Home still renders exactly the approved markup and action positions.
  const ready = new Promise((resolve) => {
    const run = () => void mount().catch(console.error).finally(resolve);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  });
  window.NovelightReaderAccount = { ready };
})();
