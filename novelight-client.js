(function () {
  'use strict';

  const VISITOR_KEY = 'novelight_visitor_token';
  const TRAFFIC_KEY = 'novelight_first_touch';
  const TOUCH_SESSION_KEY = 'novelight_touch_recorded';
  const PRODUCTION_VERCEL_HOST = 'novelrise.vercel.app';
  const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';
  const STAGING_BROWSER_CONFIG_PATH = '/api/staging-browser-config';
  const BRAND_LOGO_PATH = 'assets/novelight-header-logo.webp';
  const THEME_STYLESHEET_PATH = 'novelight-theme.css';
  const PUBLIC_HEADER_STYLESHEET_PATH = 'novelight-header-light.css';
  const THUMBNAIL_RUNTIME_PATH = 'novelight-thumbnail-runtime.js';
  const PUBLIC_HEADER_PAGES = new Set([
    'index',
    'pricing',
    'search',
    'ranking',
    'novel',
    'episode',
    'author',
    'login',
    'signup',
    'forgot-password',
    'reset-password'
  ]);
  let memoryVisitorToken = null;

  function isVercelPreviewHost() {
    const host = window.location.hostname.toLowerCase();
    return host.endsWith('.vercel.app') && host !== PRODUCTION_VERCEL_HOST;
  }

  function validateStagingBrowserConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('CONFIG_DRIFT: Staging browser config is unavailable.');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(config.supabaseUrl);
    } catch {
      throw new Error('CONFIG_DRIFT: Staging Supabase URL is invalid.');
    }

    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.username ||
      parsedUrl.password ||
      !parsedUrl.hostname.endsWith('.supabase.co') ||
      parsedUrl.hostname === PRODUCTION_SUPABASE_HOST
    ) {
      throw new Error('CONFIG_DRIFT: Refusing unsafe Staging Supabase target.');
    }

    const publishableKey = config.supabasePublishableKey;
    const isModernPublishable =
      typeof publishableKey === 'string' &&
      publishableKey.startsWith('sb_publishable_');
    const isLegacyAnon =
      typeof publishableKey === 'string' && publishableKey.startsWith('eyJ');

    if (!isModernPublishable && !isLegacyAnon) {
      throw new Error('CONFIG_DRIFT: Staging browser key is not publishable.');
    }

    return {
      supabaseUrl: parsedUrl.origin,
      supabasePublishableKey: publishableKey
    };
  }

  function loadStagingBrowserConfigSync() {
    const request = new XMLHttpRequest();
    request.open('GET', STAGING_BROWSER_CONFIG_PATH, false);
    request.setRequestHeader('Accept', 'application/json');

    try {
      request.send(null);
    } catch {
      throw new Error('CONFIG_DRIFT: Staging browser config request failed.');
    }

    if (request.status !== 200) {
      throw new Error(
        `CONFIG_DRIFT: Staging browser config returned HTTP ${request.status}.`
      );
    }

    let config;
    try {
      config = JSON.parse(request.responseText);
    } catch {
      throw new Error('CONFIG_DRIFT: Staging browser config is not valid JSON.');
    }

    return validateStagingBrowserConfig(config);
  }

  function installPreviewSupabaseBootstrap() {
    if (!isVercelPreviewHost()) return;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('CONFIG_DRIFT: Supabase browser library is unavailable.');
    }

    const originalCreateClient = window.supabase.createClient.bind(window.supabase);
    let cachedConfig = null;

    window.supabase.createClient = function (...args) {
      if (!cachedConfig) cachedConfig = loadStagingBrowserConfigSync();
      return originalCreateClient(
        cachedConfig.supabaseUrl,
        cachedConfig.supabasePublishableKey,
        ...args.slice(2)
      );
    };
  }

  installPreviewSupabaseBootstrap();

  function currentPageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').replace(/[^a-z0-9-]/giu, '-').toLowerCase();
  }

  function installAuthorDashboardShell() {
    if (currentPageSlug() !== 'mypage') return false;

    const main = document.querySelector('main');
    if (!main || main.classList.contains('novelight-author-shell')) return false;

    const profilePanel = main.querySelector('.panel');
    if (profilePanel && !profilePanel.id) profilePanel.id = 'profile';

    const sidebar = document.createElement('aside');
    sidebar.className = 'novelight-author-sidebar';
    sidebar.setAttribute('aria-label', '作者メニュー');
    sidebar.innerHTML =
      '<span class="novelight-author-sidebar-title">AUTHOR STUDIO</span>' +
      '<nav class="novelight-author-nav">' +
      '<a href="mypage.html" aria-current="page"><span class="novelight-author-nav-icon">⌂</span>ダッシュボード</a>' +
      '<a href="my-novels.html"><span class="novelight-author-nav-icon">▣</span>作品管理</a>' +
      '<a href="post.html"><span class="novelight-author-nav-icon">✎</span>新規投稿</a>' +
      '<a href="analytics.html"><span class="novelight-author-nav-icon">▥</span>LIGHT ANALYTICS</a>' +
      '<a href="scout-record.html"><span class="novelight-author-nav-icon">◇</span>SCOUT RECORD</a>' +
      '<a href="#profile"><span class="novelight-author-nav-icon">⚙</span>設定</a>' +
      '</nav>';

    const content = document.createElement('div');
    content.className = 'novelight-author-content';
    while (main.firstChild) content.appendChild(main.firstChild);
    main.append(sidebar, content);
    main.classList.add('novelight-author-shell');
    return true;
  }

  function installThemeStyles() {
    const slug = currentPageSlug();
    document.documentElement.dataset.novelightPage = slug;
    if (document.body) {
      document.body.classList.add('novelight-theme', `novelight-page-${slug}`);
    }

    const selector = 'link[data-novelight-theme="sitewide"]';
    if (!document.querySelector(selector)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = THEME_STYLESHEET_PATH;
      link.dataset.novelightTheme = 'sitewide';
      document.head.appendChild(link);
    }

    installAuthorDashboardShell();
    return slug;
  }

  installThemeStyles();

  function publicHeaderCurrent(slug, target) {
    if (target === 'discover' && ['search', 'novel', 'episode', 'author'].includes(slug)) {
      return ' aria-current="page"';
    }
    if (target === 'pricing' && slug === 'pricing') return ' aria-current="page"';
    if (target === 'ranking' && slug === 'ranking') return ' aria-current="page"';
    if (target === 'login' && ['login', 'forgot-password', 'reset-password'].includes(slug)) {
      return ' aria-current="page"';
    }
    if (target === 'signup' && slug === 'signup') return ' aria-current="page"';
    return '';
  }

  function installPublicHeader() {
    const slug = currentPageSlug();
    if (!PUBLIC_HEADER_PAGES.has(slug)) return false;

    document.body?.classList.add('novelight-public-header-page');

    if (!document.querySelector('link[data-novelight-public-header]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PUBLIC_HEADER_STYLESHEET_PATH;
      link.dataset.novelightPublicHeader = 'shared';
      document.head.appendChild(link);
    }

    const header = document.querySelector('header.site-header, header');
    if (!header) return false;

    const discoverCurrent = publicHeaderCurrent(slug, 'discover');
    const pricingCurrent = publicHeaderCurrent(slug, 'pricing');
    const rankingCurrent = publicHeaderCurrent(slug, 'ranking');
    const loginCurrent = publicHeaderCurrent(slug, 'login');
    const signupCurrent = publicHeaderCurrent(slug, 'signup');

    header.className = 'site-header';
    header.innerHTML =
      '<div class="header-inner public-header-inner">' +
      '<a class="logo" href="index.html" aria-label="NOVELIGHT ホーム"><img src="assets/novelight-header-logo.webp" alt="NOVELIGHT"></a>' +
      '<nav class="site-nav desktop-nav" aria-label="メインナビ">' +
      `<a href="search.html"${discoverCurrent}>作品を探す</a>` +
      '<a href="index.html#features">特徴</a>' +
      `<a href="pricing.html"${pricingCurrent}>料金プラン</a>` +
      `<a href="ranking.html"${rankingCurrent}>ランキング</a>` +
      '</nav>' +
      '<div class="header-actions">' +
      '<a class="header-search" href="search.html" aria-label="作品を検索"><span aria-hidden="true">⌕</span></a>' +
      `<a class="btn btn-outline login-action" href="login.html"${loginCurrent}>ログイン</a>` +
      `<a class="btn btn-primary signup-action" href="signup.html"${signupCurrent}>会員登録</a>` +
      '<details class="mobile-menu"><summary aria-label="メニューを開く">☰</summary><nav aria-label="モバイルナビ">' +
      `<a href="search.html"${discoverCurrent}>作品を探す</a>` +
      '<a href="index.html#features">特徴</a>' +
      `<a href="pricing.html"${pricingCurrent}>料金プラン</a>` +
      `<a href="ranking.html"${rankingCurrent}>ランキング</a>` +
      `<a href="login.html"${loginCurrent}>ログイン</a>` +
      `<a href="signup.html"${signupCurrent}>会員登録</a>` +
      '</nav></details>' +
      '</div>' +
      '</div>';

    return true;
  }

  installPublicHeader();

  function installBrandLogo() {
    const logos = document.querySelectorAll('.logo, .site-logo');
    if (!logos.length) return 0;

    const styleId = 'novelight-brand-logo-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent =
        '.novelight-brand-logo-image,.logo img,.site-logo img{display:block;width:auto;height:75.6px!important;max-width:42vw;object-fit:contain;filter:none!important;mix-blend-mode:normal!important}' +
        'body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) .header-inner,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) .site-header-inner{width:min(1380px,calc(100% - 48px))!important;max-width:1380px!important;min-height:96px!important;gap:32px!important}' +
        'body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .back,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .site-back,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .right>a{font-size:16px!important;font-weight:700}' +
        'body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .logout{min-height:46px;padding:10px 16px;font-size:15px}' +
        'body.novelight-public-dark .logo img,body.novelight-public-dark .novelight-brand-logo-image{height:104.4px!important}' +
        'body.novelight-public-dark .site-nav a[aria-current="page"]::after{display:none!important;content:none!important}' +
        '@media(min-width:901px){body.novelight-public-dark .public-header-inner{display:grid!important;width:min(1500px,calc(100% - 64px))!important;min-height:120px!important;grid-template-columns:auto minmax(520px,1fr) auto!important;align-items:center!important;gap:clamp(32px,3.4vw,64px)!important}body.novelight-public-dark .logo{min-width:0!important}body.novelight-public-dark .site-nav{align-self:stretch!important;justify-content:space-between!important;gap:clamp(24px,2.4vw,48px)!important;margin-left:0!important}body.novelight-public-dark .site-nav a{font-size:18px!important}body.novelight-public-dark .header-actions{gap:18px!important;margin-left:0!important}body.novelight-public-dark .header-search{width:48px!important;height:48px!important;font-size:30px!important}body.novelight-public-dark .btn{min-height:52px!important;padding:12px 24px!important;font-size:17px!important}}' +
        '@media(min-width:901px) and (max-width:1180px){body.novelight-public-dark .public-header-inner{width:calc(100% - 32px)!important;grid-template-columns:auto minmax(360px,1fr) auto!important;gap:16px!important}body.novelight-public-dark .site-nav{gap:12px!important}body.novelight-public-dark .site-nav a{font-size:16px!important}body.novelight-public-dark .header-actions{gap:10px!important}body.novelight-public-dark .header-search{width:44px!important;height:44px!important;font-size:28px!important}body.novelight-public-dark .btn{min-height:48px!important;padding:10px 14px!important;font-size:15px!important}}' +
        '@media(max-width:1180px){body.novelight-public-dark .logo img,body.novelight-public-dark .novelight-brand-logo-image{height:90px!important}}' +
        '@media(max-width:900px){body.novelight-public-dark .logo img,body.novelight-public-dark .novelight-brand-logo-image{height:82.8px!important}body.novelight-public-dark .public-header-inner{min-height:96px!important}body.novelight-public-dark .header-search,body.novelight-public-dark .mobile-menu summary{width:46px!important;height:46px!important}}' +
        '@media(max-width:640px){.novelight-brand-logo-image,.logo img,.site-logo img{height:61.2px!important;max-width:55vw}body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) .header-inner,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) .site-header-inner{width:calc(100% - 24px)!important;min-height:82px!important;gap:14px!important}body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .back,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .site-back,body.novelight-theme:not(.novelight-public-dark):not(.novelight-public-header-page) header .right>a{font-size:14px!important}body.novelight-public-dark .logo img,body.novelight-public-dark .novelight-brand-logo-image{height:72px!important;max-width:56vw!important}body.novelight-public-dark .public-header-inner{min-height:84px!important}}';
      document.head.appendChild(style);
    }

    let installed = 0;
    logos.forEach((logo) => {
      if (logo.querySelector('img')) return;
      if (logo.textContent.trim() !== 'NOVELIGHT') return;

      const image = document.createElement('img');
      image.className = 'novelight-brand-logo-image';
      image.src = BRAND_LOGO_PATH;
      image.alt = '';
      image.decoding = 'async';

      logo.textContent = '';
      logo.style.display = 'inline-flex';
      logo.style.alignItems = 'center';
      logo.style.lineHeight = '0';
      if (logo.tagName === 'A') {
        logo.setAttribute('aria-label', 'NOVELIGHT トップへ');
      } else {
        logo.setAttribute('role', 'img');
        logo.setAttribute('aria-label', 'NOVELIGHT');
      }
      logo.appendChild(image);
      installed += 1;
    });

    return installed;
  }

  installBrandLogo();

  function installMobileMenuDismiss() {
    const menus = Array.from(document.querySelectorAll('details.mobile-menu'));
    if (!menus.length) return 0;

    document.addEventListener('click', (event) => {
      menus.forEach((menu) => {
        if (menu.open && !menu.contains(event.target)) {
          menu.removeAttribute('open');
        }
      });
    });

    return menus.length;
  }

  installMobileMenuDismiss();

  function installOfficialThumbnailRuntime() {
    if (!['index', 'search', 'ranking'].includes(currentPageSlug())) return false;
    if (document.querySelector('script[data-novelight-thumbnail-runtime]')) return false;
    const script = document.createElement('script');
    script.src = THUMBNAIL_RUNTIME_PATH;
    script.defer = true;
    script.dataset.novelightThumbnailRuntime = 'official';
    document.head.appendChild(script);
    return true;
  }

  function installAdminThumbnailLink() {
    if (currentPageSlug() !== 'admin') return false;
    const actions = document.querySelector('.header-actions');
    if (!actions || actions.querySelector('a[href="admin-thumbnails.html"]')) return false;
    const link = document.createElement('a');
    link.className = 'ghost';
    link.href = 'admin-thumbnails.html';
    link.textContent = '公式サムネイル';
    actions.prepend(link);
    return true;
  }

  installOfficialThumbnailRuntime();
  installAdminThumbnailLink();

  function safeStorageGet(storage, key) {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      storage?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function makeVisitorToken() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getVisitorToken() {
    const stored = safeStorageGet(window.localStorage, VISITOR_KEY);
    if (stored && stored.length >= 8) {
      memoryVisitorToken = stored;
      return stored;
    }
    if (memoryVisitorToken) return memoryVisitorToken;

    memoryVisitorToken = makeVisitorToken();
    safeStorageSet(window.localStorage, VISITOR_KEY, memoryVisitorToken);
    return memoryVisitorToken;
  }

  function referrerHost() {
    if (!document.referrer) return null;
    try {
      return new URL(document.referrer).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  function detectSource() {
    const params = new URLSearchParams(window.location.search);
    const utmSource = (params.get('utm_source') || '').trim().toLowerCase();
    const host = referrerHost();

    if (utmSource) return utmSource.slice(0, 40);
    if (
      host &&
      (host === 'x.com' ||
        host.endsWith('.x.com') ||
        host === 't.co' ||
        host === 'twitter.com' ||
        host.endsWith('.twitter.com'))
    ) {
      return 'x';
    }
    return host ? 'referral' : 'direct';
  }

  function currentTouch() {
    const params = new URLSearchParams(window.location.search);
    return {
      source: detectSource(),
      medium: (params.get('utm_medium') || '').trim().slice(0, 80) || null,
      campaign: (params.get('utm_campaign') || '').trim().slice(0, 120) || null,
      content: (params.get('utm_content') || '').trim().slice(0, 120) || null,
      landingPath: window.location.pathname.slice(0, 500) || '/',
      referrerHost: referrerHost()
    };
  }

  function getStoredTouch() {
    try {
      const parsed = JSON.parse(safeStorageGet(window.localStorage, TRAFFIC_KEY) || 'null');
      if (parsed && typeof parsed.source === 'string') return parsed;
    } catch {
      // Ignore malformed local storage and replace it with a safe first touch.
    }
    return null;
  }

  async function syncAuthHeader(client) {
    if (!client) return false;

    const headerActions = document.querySelector('.header-actions');
    const loginLink = headerActions?.querySelector('a[href="login.html"]');
    if (!loginLink) return false;

    try {
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.error('auth header session lookup failed', error);
        return false;
      }

      if (data?.session) {
        loginLink.textContent = '作者ホーム';
        loginLink.href = 'mypage.html';
        loginLink.dataset.authState = 'authenticated';
        return true;
      }

      loginLink.textContent = 'ログイン';
      loginLink.href = 'login.html';
      loginLink.dataset.authState = 'anonymous';
      return false;
    } catch (error) {
      console.error('auth header session lookup failed', error);
      return false;
    }
  }

  async function captureAcquisition(client) {
    if (!client) return;

    void syncAuthHeader(client);

    const touch = currentTouch();
    let stored = getStoredTouch();
    if (!stored) {
      stored = { ...touch, capturedAt: new Date().toISOString() };
      safeStorageSet(window.localStorage, TRAFFIC_KEY, JSON.stringify(stored));
    }

    if (safeStorageGet(window.sessionStorage, TOUCH_SESSION_KEY) === '1') return;

    void Promise.resolve(
      client.rpc('record_acquisition_touch', {
        p_visitor_token: getVisitorToken(),
        p_source: touch.source,
        p_medium: touch.medium,
        p_campaign: touch.campaign,
        p_content: touch.content,
        p_landing_path: touch.landingPath,
        p_referrer_host: touch.referrerHost
      })
    )
      .then(({ error }) => {
        if (!error) safeStorageSet(window.sessionStorage, TOUCH_SESSION_KEY, '1');
        else console.error('acquisition touch failed', error);
      })
      .catch((error) => console.error('acquisition touch failed', error));
  }

  function storedSource() {
    return getStoredTouch()?.source || detectSource();
  }

  async function recordVisit(client) {
    if (!client) return;
    void Promise.resolve(
      client.rpc('record_beta_visit', {
        p_visitor_token: getVisitorToken(),
        p_path: window.location.pathname.slice(0, 500) || '/',
        p_source: storedSource()
      })
    )
      .then(({ error }) => {
        if (error) console.error('beta visit record failed', error);
      })
      .catch((error) => console.error('beta visit record failed', error));
  }

  async function claimAcquisition(client) {
    if (!client) return false;
    try {
      const { data: authData } = await client.auth.getSession();
      if (!authData?.session) return false;
      const { error } = await client.rpc('claim_user_acquisition', {
        p_visitor_token: getVisitorToken()
      });
      if (error) {
        console.error('acquisition claim failed', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('acquisition claim failed', error);
      return false;
    }
  }

  async function recordJourney(client, eventType, novelId, episodeId = null) {
    if (!client || !novelId) return false;
    try {
      const { data, error } = await client.rpc('record_reader_journey_event', {
        p_event_type: eventType,
        p_novel_id: String(novelId),
        p_episode_id: episodeId == null ? null : String(episodeId),
        p_visitor_token: getVisitorToken(),
        p_source: storedSource()
      });
      if (error) {
        console.error('reader journey record failed', error);
        return false;
      }
      return data === true;
    } catch (error) {
      console.error('reader journey record failed', error);
      return false;
    }
  }

  window.NovelightClient = {
    getVisitorToken,
    captureAcquisition,
    recordVisit,
    claimAcquisition,
    recordJourney,
    storedSource,
    syncAuthHeader,
    installPublicHeader,
    installBrandLogo,
    installThemeStyles,
    installAuthorDashboardShell
  };
})();