(() => {
  if (!document.body || !window.supabase) return;

  const page = window.location.pathname.split('/').pop() || 'mypage.html';
  const navItems = [
    ['mypage.html', '⌂', '創作室'],
    ['post.html', '✦', '新規投稿'],
    ['my-novels.html', '▤', '自分の作品'],
    ['analytics.html', '▥', 'LIGHT ANALYTICS'],
    ['scout-record.html', '◇', 'SCOUT RECORD'],
  ];

  const existingHeader = Array.from(document.body.children).find(node => node.tagName === 'HEADER');
  const main = Array.from(document.body.children).find(node => node.tagName === 'MAIN');
  if (!main) return;
  existingHeader?.remove();

  const menuToggle = document.createElement('button');
  menuToggle.id = 'menuToggle';
  menuToggle.className = 'mobile-menu';
  menuToggle.type = 'button';
  menuToggle.setAttribute('aria-label', '創作室メニューを開く');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.textContent = '☰';

  const scrim = document.createElement('button');
  scrim.id = 'navScrim';
  scrim.className = 'nav-scrim';
  scrim.type = 'button';
  scrim.setAttribute('aria-label', '創作室メニューを閉じる');

  const menu = document.createElement('aside');
  menu.id = 'studioSidebar';
  menu.className = 'studio-sidebar';
  menu.setAttribute('aria-label', '創作室メニュー');

  const brand = document.createElement('a');
  brand.className = 'studio-brand';
  brand.href = 'index.html';
  const brandImage = document.createElement('img');
  brandImage.src = 'assets/novelight-header-logo.webp';
  brandImage.alt = 'NOVELIGHT';
  const brandSmall = document.createElement('small');
  brandSmall.textContent = 'Author Studio';
  brand.append(brandImage, brandSmall);

  const studioLabel = document.createElement('div');
  studioLabel.className = 'studio-label';
  studioLabel.textContent = 'AUTHOR STUDIO';

  const nav = document.createElement('nav');
  nav.className = 'studio-nav';
  navItems.forEach(([href, icon, label]) => {
    const link = document.createElement('a');
    link.href = href;
    if (page === href) link.setAttribute('aria-current', 'page');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-icon';
    iconSpan.textContent = icon;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    link.append(iconSpan, labelSpan);
    nav.appendChild(link);
  });

  const quote = document.createElement('div');
  quote.className = 'sidebar-quote';
  ['物語を書く時間も、', '届いた光を確かめる時間も、', '作者の大切な創作です。'].forEach(text => {
    const line = document.createElement('span');
    line.className = 'sidebar-quote-line';
    line.textContent = text;
    quote.appendChild(line);
  });
  const quoteStrong = document.createElement('strong');
  quoteStrong.textContent = 'WRITE A BRIGHTER STORY.';
  quote.appendChild(quoteStrong);
  menu.append(brand, studioLabel, nav, quote);

  const authorShell = document.createElement('div');
  authorShell.className = 'author-shell';
  const workspaceTop = document.createElement('header');
  workspaceTop.className = 'workspace-top';
  const readerHome = document.createElement('a');
  readerHome.href = 'index.html';
  readerHome.textContent = '読者ホームへ';

  const accountChip = document.createElement('div');
  accountChip.className = 'account-chip';
  accountChip.setAttribute('aria-label', 'ログイン中の作者');
  const accountAvatar = document.createElement('div');
  accountAvatar.id = 'accountAvatar';
  accountAvatar.className = 'account-avatar';
  accountAvatar.textContent = '作';
  const accountText = document.createElement('div');
  accountText.className = 'account-text';
  const accountName = document.createElement('strong');
  accountName.id = 'accountName';
  accountName.textContent = '作者アカウント';
  const accountMeta = document.createElement('span');
  accountMeta.textContent = 'AUTHOR ACCOUNT';
  accountText.append(accountName, accountMeta);
  accountChip.append(accountAvatar, accountText);

  const logout = document.createElement('button');
  logout.id = 'logout';
  logout.className = 'logout';
  logout.type = 'button';
  logout.textContent = 'ログアウト';
  workspaceTop.append(readerHome, accountChip, logout);

  document.body.insertBefore(menuToggle, document.body.firstChild);
  document.body.insertBefore(scrim, menuToggle.nextSibling);
  document.body.insertBefore(menu, scrim.nextSibling);
  document.body.insertBefore(authorShell, main);
  authorShell.append(workspaceTop, main);

  function toggleStudioNav(force) {
    const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.textContent = open ? '×' : '☰';
  }

  menuToggle.addEventListener('click', () => toggleStudioNav());
  scrim.addEventListener('click', () => toggleStudioNav(false));
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => toggleStudioNav(false)));

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );

  function initials(value) {
    const text = String(value || '作者').trim();
    return text ? text.slice(0, 1) : '作';
  }

  function setAvatar(path, displayName) {
    accountAvatar.replaceChildren();
    if (!path) {
      accountAvatar.textContent = initials(displayName);
      return;
    }

    const publicUrl = client.storage.from('author-avatars').getPublicUrl(path).data.publicUrl || '';
    if (!publicUrl) {
      accountAvatar.textContent = initials(displayName);
      return;
    }

    const image = document.createElement('img');
    image.src = publicUrl;
    image.alt = `${displayName || '作者'}のアイコン`;
    image.onerror = () => {
      accountAvatar.replaceChildren();
      accountAvatar.textContent = initials(displayName);
    };
    accountAvatar.appendChild(image);
  }

  async function loadAccount() {
    try {
      const auth = await client.auth.getSession();
      const session = auth.data.session;
      if (!session) return;

      let profile = await client
        .from('profiles')
        .select('display_name,avatar_path')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profile.error) {
        profile = await client.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
      }

      const displayName = profile.data?.display_name || '作者';
      accountName.textContent = displayName;
      setAvatar(profile.data?.avatar_path || null, displayName);
    } catch (error) {
      console.error('Author Studio shell account display unavailable', error);
    }
  }

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const result = await client.auth.signOut();
      if (result.error) throw result.error;
      window.location.href = 'index.html';
    } catch (error) {
      console.error(error);
      alert('ログアウトできませんでした。時間をおいて再度お試しください。');
      logout.disabled = false;
    }
  });

  void loadAccount();
})();
