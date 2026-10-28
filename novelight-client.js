(function () {
  'use strict';

  // Single public release gate; also applies to all shared public headers.
  window.NOVELIGHT_COMMUNITY_FLAGS = Object.freeze({
    timeline: true,
    board: true
  });
  // Keep static public navigation behind the existing joint release gate.
  // This runs before first paint so an inactive plaza never flashes a link.
  document.documentElement.classList.toggle(
    'novelight-community-released',
    window.NOVELIGHT_COMMUNITY_FLAGS.timeline &&
      window.NOVELIGHT_COMMUNITY_FLAGS.board
  );
  const VISITOR_KEY = 'novelight_visitor_token';
  const TRAFFIC_KEY = 'novelight_first_touch';
  const TOUCH_SESSION_KEY = 'novelight_touch_recorded';
  // X Pixel IDs are public measurement identifiers. Keep them blank until
  // Event Manager values are formally configured for Production.
  const X_PIXEL_CONFIG = Object.freeze({
    pixelId: '',
    signupEventId: ''
  });
  const X_PIXEL_LIBRARY_URL = 'https://static.ads-twitter.com/uwt.js';
  const X_PIXEL_PRODUCTION_HOSTS = new Set([
    'novelight.jp',
    'www.novelight.jp'
  ]);
  const X_SIGNUP_STORAGE_PREFIX = 'novelight_x_signup_conversion:';
  // Infrastructure alias used only to distinguish Vercel Production from Preview.
  const VERCEL_INTERNAL_PRODUCTION_HOST = 'novelrise.vercel.app';
  const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';
  const STAGING_BROWSER_CONFIG_PATH = '/api/staging-browser-config';
  const BRAND_LOGO_PATH = 'assets/novelight-header-logo.webp';
  const THEME_STYLESHEET_PATH = 'novelight-theme.css';
  const PUBLIC_HEADER_STYLESHEET_PATH = 'novelight-header-light.css';
  const THUMBNAIL_RUNTIME_PATH = 'novelight-thumbnail-runtime.js';
  const AUTHOR_STUDIO_SHELL_STYLESHEET_PATH =
    'novelight-author-studio-shell.css';
  const AUTHOR_STUDIO_SHELL_RUNTIME_PATH = 'novelight-author-studio-shell.js';
  const AUTHOR_STUDIO_SHELL_PAGES = new Set([
    'post',
    'my-novels',
    'series',
    'bulk-import',
    'analytics',
    'scout-record',
    'interaction-settings'
  ]);
  const PUBLIC_HEADER_PAGES = new Set([
    'index',
    'pricing',
    'search',
    'ranking',
    'community',
    'novel',
    'episode',
    'author',
    'login',
    'signup',
    'forgot-password',
    'reset-password',
    'announcements',
    'contact',
    'news-detail',
    'special-light',
    'special-zone'
  ]);
  let memoryVisitorToken = null;

  function isVercelPreviewHost() {
    const host = window.location.hostname.toLowerCase();
    return (
      host.endsWith('.vercel.app') &&
      host !== VERCEL_INTERNAL_PRODUCTION_HOST
    );
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
      throw new Error(
        'CONFIG_DRIFT: Staging browser config is not valid JSON.'
      );
    }

    return validateStagingBrowserConfig(config);
  }

  function installPreviewSupabaseBootstrap() {
    if (!isVercelPreviewHost()) return;
    if (
      !window.supabase ||
      typeof window.supabase.createClient !== 'function'
    ) {
      throw new Error('CONFIG_DRIFT: Supabase browser library is unavailable.');
    }

    const originalCreateClient = window.supabase.createClient.bind(
      window.supabase
    );
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
    return file
      .replace(/\.html$/u, '')
      .replace(/[^a-z0-9-]/giu, '-')
      .toLowerCase();
  }

  function installAuthorDashboardShell() {
    if (currentPageSlug() !== 'mypage') return false;

    const main = document.querySelector('main');
    if (!main || main.classList.contains('novelight-author-shell'))
      return false;

    const profilePanel = main.querySelector('.profile-panel');
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

  function installAuthorStudioSharedShell() {
    const slug = currentPageSlug();
    if (!AUTHOR_STUDIO_SHELL_PAGES.has(slug)) return false;

    document.body?.classList.add('novelight-author-studio-shell');

    if (!document.querySelector('link[data-novelight-author-studio-shell]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = AUTHOR_STUDIO_SHELL_STYLESHEET_PATH;
      link.dataset.novelightAuthorStudioShell = 'shared';
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-novelight-author-studio-shell]')) {
      const script = document.createElement('script');
      script.src = AUTHOR_STUDIO_SHELL_RUNTIME_PATH;
      script.async = false;
      script.dataset.novelightAuthorStudioShell = 'shared';
      document.body.appendChild(script);
    }

    return true;
  }

  installAuthorStudioSharedShell();

  function publicHeaderCurrent(slug, target) {
    if (
      target === 'discover' &&
      ['search', 'novel', 'episode', 'author'].includes(slug)
    ) {
      return ' aria-current="page"';
    }
    if (target === 'pricing' && slug === 'pricing')
      return ' aria-current="page"';
    if (target === 'announcements' && ['announcements', 'news-detail'].includes(slug))
      return ' aria-current="page"';
    if (target === 'community' && slug === 'community')
      return ' aria-current="page"';
    if (target === 'ranking' && slug === 'ranking')
      return ' aria-current="page"';
    if (
      target === 'login' &&
      ['login', 'forgot-password', 'reset-password'].includes(slug)
    ) {
      return ' aria-current="page"';
    }
    if (target === 'signup' && slug === 'signup') return ' aria-current="page"';
    return '';
  }

  function installPublicHeader() {
    const slug = currentPageSlug();
    if (!PUBLIC_HEADER_PAGES.has(slug)) return false;

    document.body?.classList.add('novelight-public-header-page');

    // The accessibility entry stylesheet already imports the complete public
    // header CSS. Avoid appending the same stylesheet after first paint.
    const hasHeaderCss = document.querySelector(
      'link[data-novelight-public-header], ' +
        'link[href="novelight-header-light.css"], ' +
        'link[href="novelight-accessibility.css"]'
    );
    if (!hasHeaderCss) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PUBLIC_HEADER_STYLESHEET_PATH;
      link.dataset.novelightPublicHeader = 'shared';
      document.head.appendChild(link);
    }

    const header = document.querySelector('header.site-header, header');
    if (!header) return false;

    const discoverCurrent = publicHeaderCurrent(slug, 'discover');
    const announcementsCurrent = publicHeaderCurrent(slug, 'announcements');
    const rankingCurrent = publicHeaderCurrent(slug, 'ranking');
    const communityCurrent = publicHeaderCurrent(slug, 'community');
    const loginCurrent = publicHeaderCurrent(slug, 'login');
    const signupCurrent = publicHeaderCurrent(slug, 'signup');

    // Most public pages already ship the finished header in their HTML.
    // Replacing it after first paint causes visible navigation and logo jumps.
    // Only rebuild truly legacy headers; keep auth link classes up to date.
    const staticHeader =
      header.classList.contains('site-header') &&
      header.querySelector('.public-header-inner > .logo img') &&
      header.querySelector('.site-nav.desktop-nav') &&
      header.querySelector('.header-actions .header-search') &&
      header.querySelector('.header-actions .login-action') &&
      header.querySelector('.header-actions .signup-action') &&
      header.querySelector('.mobile-menu nav[aria-label="モバイルナビ"]');

    if (staticHeader) {
      const currentLinks = [
        ['search.html', discoverCurrent],
        ['ranking.html', rankingCurrent],
        ['community.html', communityCurrent],
        ['announcements.html', announcementsCurrent]
      ];
      header.querySelectorAll('.site-nav a, .mobile-menu nav a').forEach((link) => {
        const current = currentLinks.find(([href]) => link.getAttribute('href') === href);
        if (current?.[1]) link.setAttribute('aria-current', 'page');
      });

      const mobileNav = header.querySelector('.mobile-menu nav');
      const mobileLogin = mobileNav.querySelector('a[href="login.html"]');
      if (mobileLogin) mobileLogin.classList.add('mobile-login-action');
      if (!mobileNav.querySelector('.mobile-signup-action')) {
        const mobileSignup = document.createElement('a');
        mobileSignup.className = 'mobile-signup-action';
        mobileSignup.href = 'signup.html';
        mobileSignup.textContent = '会員登録';
        if (signupCurrent) mobileSignup.setAttribute('aria-current', 'page');
        mobileNav.appendChild(mobileSignup);
      }
      return true;
    }

    header.className = 'site-header';
    header.innerHTML =
      '<div class="header-inner public-header-inner">' +
      '<a class="logo" href="index.html" aria-label="NOVELIGHT ホーム"><img src="assets/novelight-header-logo.webp" alt="NOVELIGHT"></a>' +
      '<nav class="site-nav desktop-nav" aria-label="メインナビ">' +
      `<a href="search.html"${discoverCurrent}>作品を探す</a>` +
      `<a href="ranking.html"${rankingCurrent}>ランキング</a>` +
      `<a href="community.html"${communityCurrent}>交流</a>` +
      `<a href="announcements.html"${announcementsCurrent}>お知らせ</a>` +
      '</nav>' +
      '<div class="header-actions">' +
      '<a class="header-search" href="search.html" aria-label="作品を検索"><span aria-hidden="true">⌕</span></a>' +
      `<a class="btn btn-outline login-action" href="login.html"${loginCurrent}>ログイン</a>` +
      `<a class="btn btn-primary signup-action" href="signup.html"${signupCurrent}>会員登録</a>` +
      '<details class="mobile-menu"><summary aria-label="メニューを開く">☰</summary><nav aria-label="モバイルナビ">' +
      `<a href="search.html"${discoverCurrent}>作品を探す</a>` +
      `<a href="ranking.html"${rankingCurrent}>ランキング</a>` +
      `<a href="community.html"${communityCurrent}>交流</a>` +
      `<a href="announcements.html"${announcementsCurrent}>お知らせ</a>` +
      `<a class="mobile-login-action" href="login.html"${loginCurrent}>ログイン</a>` +
      `<a class="mobile-signup-action" href="signup.html"${signupCurrent}>会員登録</a>` +
      '</nav></details>' +
      '</div>' +
      '</div>';

    return true;
  }

  installPublicHeader();

  // Public pages share the Home bookshelf/avatar renderer. Install it once
  // through the sitewide client instead of copying a script into every page.
  // Home already loads this runtime statically; Author Studio uses its own
  // independent dark header and is intentionally outside this public scope.
  function installPublicReaderAccount() {
    const slug = currentPageSlug();
    if (slug === 'index' || slug === 'favorites') return false;
    if (
      !document.body?.classList.contains('novelight-public-header-page') ||
      !document.querySelector(
        'header.site-header .public-header-inner .header-actions'
      )
    ) {
      return false;
    }
    // Keep campaign, admin, and custom headers outside this runtime.
    if (!window.supabase?.createClient) return false;
    if (document.querySelector('script[src^="novelight-reader-account.js"]')) {
      return true;
    }
    const script = document.createElement('script');
    script.src = 'novelight-reader-account.js';
    script.dataset.novelightReaderAccount = 'public';
    document.body.appendChild(script);
    return true;
  }

  installPublicReaderAccount();



  function installBrandLogo() {
    const logos = document.querySelectorAll('.logo, .site-logo');
    if (!logos.length) return 0;

    // Geometry is render-blocking in novelight-header-first-paint.css.
    // Do not inject another copy after first paint.

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
    if (!['index', 'search', 'ranking', 'community', 'curation',
      'favorites', 'series', 'reading-history'].includes(currentPageSlug()))
      return false;
    if (document.querySelector('script[data-novelight-thumbnail-runtime]'))
      return false;
    const script = document.createElement('script');
    script.src = THUMBNAIL_RUNTIME_PATH;
    script.defer = true;
    script.dataset.novelightThumbnailRuntime = 'covers';
    document.head.appendChild(script);
    return true;
  }

  function installAdminThumbnailLink() {
    if (currentPageSlug() !== 'admin') return false;
    const actions = document.querySelector('.header-actions');
    if (!actions || actions.querySelector('a[href="admin-thumbnails.html"]'))
      return false;
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
      const parsed = JSON.parse(
        safeStorageGet(window.localStorage, TRAFFIC_KEY) || 'null'
      );
      if (parsed && typeof parsed.source === 'string') return parsed;
    } catch {
      // Ignore malformed local storage and replace it with a safe first touch.
    }
    return null;
  }

  async function syncAuthHeader(client) {
    if (!client) return false;

    const headerActions = document.querySelector('.header-actions');
    const loginLinks = Array.from(
      headerActions?.querySelectorAll(
        '.login-action, .mobile-login-action'
      ) || []
    );
    const signupLinks = Array.from(
      headerActions?.querySelectorAll(
        '.signup-action, .mobile-signup-action'
      ) || []
    );
    if (!loginLinks.length) return false;

    function setSignupVisibility(hidden) {
      signupLinks.forEach((signupLink) => {
        signupLink.hidden = hidden;
        signupLink.dataset.authState = hidden
          ? 'authenticated-hidden'
          : 'anonymous';
        if (hidden) {
          signupLink.setAttribute('aria-hidden', 'true');
          signupLink.setAttribute('tabindex', '-1');
        } else {
          signupLink.removeAttribute('aria-hidden');
          signupLink.removeAttribute('tabindex');
        }
      });
    }

    try {
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.error('auth header session lookup failed', error);
        return false;
      }

      if (data?.session) {
        loginLinks.forEach((loginLink) => {
          loginLink.textContent = '創作室';
          loginLink.href = 'mypage.html';
          loginLink.dataset.authState = 'authenticated';
        });
        setSignupVisibility(true);
        return true;
      }

      loginLinks.forEach((loginLink) => {
        loginLink.textContent = 'ログイン';
        loginLink.href = 'login.html';
        loginLink.dataset.authState = 'anonymous';
      });
      setSignupVisibility(false);
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

    if (safeStorageGet(window.sessionStorage, TOUCH_SESSION_KEY) === '1')
      return;

    void analyticsEvent(client, {
      action: 'acquisition',
      source: touch.source,
      medium: touch.medium,
      campaign: touch.campaign,
      content: touch.content,
      landing_path: touch.landingPath,
      referrer_host: touch.referrerHost
    })
      .then(() => {
        safeStorageSet(window.sessionStorage, TOUCH_SESSION_KEY, '1');
      })
      .catch((error) => console.error('acquisition touch failed', error));
  }

  function storedSource() {
    return getStoredTouch()?.source || detectSource();
  }

  async function analyticsEvent(client, payload) {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const { data } = await client.auth.getSession();
      if (data?.session?.access_token) {
        headers.Authorization = `Bearer ${data.session.access_token}`;
      }
    } catch (error) {
      console.error('analytics session lookup failed', error);
    }

    const response = await fetch('/api/analytics-event', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok)
      throw new Error(`Analytics request failed: ${response.status}`);
    return response.json();
  }

  async function recordVisit(client) {
    if (!client) return;
    void analyticsEvent(client, {
      action: 'visit',
      path: window.location.pathname.slice(0, 500) || '/',
      source: storedSource()
    }).catch((error) => console.error('beta visit record failed', error));
  }

  async function claimAcquisition(client) {
    if (!client) return false;
    try {
      const { data: authData } = await client.auth.getSession();
      if (!authData?.session) return false;
      const result = await analyticsEvent(client, { action: 'claim' });
      return result?.accepted === true;
    } catch (error) {
      console.error('acquisition claim failed', error);
      return false;
    }
  }

  // Only reader journey attribution is overridden by a verified internal landing
  // marker. Never rewrite acquisition source, paid marketing attribution or PV.
  function readerJourneySource() {
    const path = window.location.pathname.split('/').pop();
    if (path === 'novel.html' || path === 'episode.html') {
      const marker = new URLSearchParams(window.location.search).get('source');
      if (marker === 'community') return 'community';
    }
    return storedSource();
  }

  async function recordJourney(client, eventType, novelId, episodeId = null) {
    if (!client || !novelId) return false;
    try {
      const result = await analyticsEvent(client, {
        action: 'journey',
        event_type: eventType,
        novel_id: String(novelId),
        episode_id: episodeId == null ? null : String(episodeId),
        source: readerJourneySource()
      });
      return result?.accepted === true;
    } catch (error) {
      console.error('reader journey record failed', error);
      return false;
    }
  }

  async function recordEpisodePv(client, episodeId) {
    if (!client || !episodeId) return false;
    try {
      const result = await analyticsEvent(client, {
        action: 'episode-pv',
        episode_id: String(episodeId)
      });
      return result?.accepted === true;
    } catch (error) {
      console.error('pv increment failed', error);
      return false;
    }
  }

  async function recordNeutralSearchImpressions(client, novelIds) {
    if (!client || !Array.isArray(novelIds) || novelIds.length === 0) return 0;
    try {
      const result = await analyticsEvent(client, {
        action: 'neutral-search-impressions',
        novel_ids: novelIds.map(String)
      });
      return Number(result?.recorded_count) || 0;
    } catch (error) {
      console.error('neutral search telemetry failed', error);
      return 0;
    }
  }

  function getXPixelConfig() {
    const runtimeConfig =
      window.NOVELIGHT_X_PIXEL_CONFIG &&
      typeof window.NOVELIGHT_X_PIXEL_CONFIG === 'object'
        ? window.NOVELIGHT_X_PIXEL_CONFIG
        : {};

    return {
      pixelId: String(
        runtimeConfig.pixelId || X_PIXEL_CONFIG.pixelId || ''
      ).trim(),
      signupEventId: String(
        runtimeConfig.signupEventId || X_PIXEL_CONFIG.signupEventId || ''
      ).trim()
    };
  }

  function isXPixelProductionHost() {
    return X_PIXEL_PRODUCTION_HOSTS.has(window.location.hostname.toLowerCase());
  }

  function isValidXPixelId(value) {
    return /^[A-Za-z0-9_-]{2,64}$/.test(String(value || ''));
  }

  function isValidXEventId(value) {
    return /^tw-[A-Za-z0-9_-]{2,128}$/.test(String(value || ''));
  }

  function installXPixel() {
    const config = getXPixelConfig();
    if (!isXPixelProductionHost() || !isValidXPixelId(config.pixelId)) {
      return false;
    }
    if (window.__novelightXPixelInstalled) return true;

    const twq =
      window.twq ||
      function () {
        twq.exe
          ? twq.exe.apply(twq, arguments)
          : twq.queue.push(arguments);
      };

    if (!window.twq) {
      twq.version = '1.1';
      twq.queue = [];
      window.twq = twq;
    }

    if (!document.querySelector('script[data-novelight-x-pixel="base"]')) {
      const script = document.createElement('script');
      script.src = X_PIXEL_LIBRARY_URL;
      script.async = true;
      script.dataset.novelightXPixel = 'base';
      document.head.appendChild(script);
    }

    window.twq('config', config.pixelId);
    window.__novelightXPixelInstalled = true;
    return true;
  }

  function trackXSignupConversion(userId) {
    const config = getXPixelConfig();
    if (
      !isXPixelProductionHost() ||
      !isValidXPixelId(config.pixelId) ||
      !isValidXEventId(config.signupEventId) ||
      !installXPixel()
    ) {
      return false;
    }

    const normalizedUserId = String(userId || '').trim();
    const dedupeKey = normalizedUserId
      ? `${X_SIGNUP_STORAGE_PREFIX}${normalizedUserId}`
      : '';

    try {
      if (dedupeKey && window.localStorage.getItem(dedupeKey) === '1') {
        return false;
      }
    } catch {
      // Storage can be unavailable in hardened browser modes. Tracking itself
      // remains best-effort and must never block registration.
    }

    try {
      window.twq('event', config.signupEventId);
      if (dedupeKey) {
        try {
          window.localStorage.setItem(dedupeKey, '1');
        } catch {
          // See storage note above.
        }
      }
      return true;
    } catch (error) {
      console.error('X signup conversion failed', {
        name: error?.name || 'Error'
      });
      return false;
    }
  }

  function installScoutTitleToastRuntime() {
    if (window.__novelightScoutTitleToastRuntimeInstalled) return false;
    window.__novelightScoutTitleToastRuntimeInstalled = true;

    if (!Array.isArray(window.__novelightScoutTitleToastPendingClients)) {
      window.__novelightScoutTitleToastPendingClients = [];
    }

    if (
      window.supabase &&
      typeof window.supabase.createClient === 'function' &&
      !window.__novelightScoutTitleToastCaptureInstalled
    ) {
      const createClient = window.supabase.createClient.bind(window.supabase);
      window.supabase.createClient = function (...args) {
        const client = createClient(...args);
        window.__novelightScoutTitleToastPendingClients.push(client);
        if (
          typeof window.__novelightAttachScoutTitleToastWatcher === 'function'
        ) {
          window.__novelightAttachScoutTitleToastWatcher(client);
        }
        return client;
      };
      window.__novelightScoutTitleToastCaptureInstalled = true;
    }

    const script = document.createElement('script');
    script.src = 'novelight-scout-title-toast.js';
    script.async = false;
    script.dataset.novelightScoutTitleToast = 'sitewide';
    document.head.appendChild(script);
    return true;
  }

  installXPixel();
  installScoutTitleToastRuntime();

  window.NovelightClient = {
    getVisitorToken,
    captureAcquisition,
    recordVisit,
    claimAcquisition,
    recordJourney,
    recordEpisodePv,
    recordNeutralSearchImpressions,
    trackXSignupConversion,
    storedSource,
    syncAuthHeader,
    installPublicHeader,
    installBrandLogo,
    installThemeStyles,
    installAuthorDashboardShell,
    installAuthorStudioSharedShell
  };
})();
