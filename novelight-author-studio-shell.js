(() => {
  const menu = document.getElementById('studioSidebar');
  const scrim = document.getElementById('navScrim');
  const menuToggle = document.getElementById('menuToggle');
  const logout = document.getElementById('logout');
  const accountName = document.getElementById('accountName');
  const accountAvatar = document.getElementById('accountAvatar');

  if (!menu || !scrim || !menuToggle || !logout || !accountName || !accountAvatar || !window.supabase) return;

  function toggleStudioNav(force) {
    const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.textContent = open ? '×' : '☰';
  }

  menuToggle.addEventListener('click', () => toggleStudioNav());
  scrim.addEventListener('click', () => toggleStudioNav(false));
  menu.querySelectorAll('.studio-nav a').forEach(link => link.addEventListener('click', () => toggleStudioNav(false)));

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
