(() => {
  'use strict';

  const SCOUT_TITLE_TOAST_FALLBACK_POLL_MS = 60000;
  const SCOUT_TITLE_TOAST_VISIBLE_MS = 5000;
  const SCOUT_RECORD_UPDATED_EVENT = 'novelight:scout-record-updated';
  const CURSOR_PREFIX = 'novelight_scout_title_toast_cursor_v1:';
  const memoryCursors = new Map();

  function storageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Memory fallback below still prevents duplicate toasts in this page.
    }
  }

  function displayName(row) {
    const base = String(row?.display_name || 'SCOUT称号');
    if (row?.badge_id !== 'limited_founding_author') return base;
    const number = Number(row?.metadata?.founding_number);
    if (!Number.isInteger(number) || number < 1) return base;
    return 'Founding Author #' + String(number).padStart(3, '0');
  }

  function installStyles() {
    if (document.getElementById('novelight-scout-title-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'novelight-scout-title-toast-style';
    style.textContent =
      '.novelight-scout-title-toast-stack{position:fixed;top:18px;right:18px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:min(320px,calc(100vw - 24px));pointer-events:none}' +
      '.novelight-scout-title-toast{box-sizing:border-box;width:min(300px,100%);padding:10px 12px;border:1px solid rgba(226,190,92,.62);border-radius:11px;background:rgba(5,22,38,.97);box-shadow:0 12px 30px rgba(0,0,0,.28);color:#fff;opacity:1;transform:translateY(0);transition:opacity .32s ease,transform .32s ease}' +
      '.novelight-scout-title-toast.is-leaving{opacity:0;transform:translateY(-6px)}' +
      '.novelight-scout-title-toast-kicker{color:#f3d77a;font-size:10px;font-weight:900;letter-spacing:.08em}' +
      '.novelight-scout-title-toast-name{margin-top:4px;color:#fff8e8;font-size:14px;font-weight:900;line-height:1.35}' +
      '.novelight-scout-title-toast-condition{margin-top:3px;color:#d8e0e7;font-size:11px;font-weight:600;line-height:1.45}' +
      '@media(max-width:520px){.novelight-scout-title-toast-stack{top:10px;right:10px;width:min(290px,calc(100vw - 20px))}.novelight-scout-title-toast{padding:9px 10px}.novelight-scout-title-toast-name{font-size:13px}.novelight-scout-title-toast-condition{font-size:10px}}';
    document.head.appendChild(style);
  }

  function stack() {
    installStyles();
    let node = document.querySelector('.novelight-scout-title-toast-stack');
    if (node) return node;
    node = document.createElement('div');
    node.className = 'novelight-scout-title-toast-stack';
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'false');
    document.body?.appendChild(node);
    return node;
  }

  function showToast(row) {
    const host = stack();
    if (!host) return;

    const toast = document.createElement('div');
    toast.className = 'novelight-scout-title-toast';
    toast.setAttribute('role', 'status');

    const kicker = document.createElement('div');
    kicker.className = 'novelight-scout-title-toast-kicker';
    kicker.textContent = '✦ SCOUT称号を獲得';

    const name = document.createElement('div');
    name.className = 'novelight-scout-title-toast-name';
    name.textContent = displayName(row);

    const condition = document.createElement('div');
    condition.className = 'novelight-scout-title-toast-condition';
    condition.textContent =
      '達成条件：' + String(row?.description || '称号条件を達成');

    toast.append(kicker, name, condition);
    host.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 350);
    }, SCOUT_TITLE_TOAST_VISIBLE_MS);
  }

  async function installAdminShortcut(session) {
    if (!session?.access_token) return false;
    const page = (window.location.pathname.split('/').pop() || 'index.html')
      .replace(/\.html$/u, '')
      .toLowerCase();
    if (page.startsWith('admin')) return false;
    if (document.querySelector('.novelight-admin-shortcut')) return true;

    try {
      const response = await fetch('/api/admin-access', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + session.access_token
        }
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null);
      if (!payload?.admin) return false;

      if (!document.getElementById('novelight-admin-shortcut-style')) {
        const style = document.createElement('style');
        style.id = 'novelight-admin-shortcut-style';
        style.textContent =
          '.novelight-admin-shortcut{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 12px;border:1px solid rgba(216,180,90,.6);border-radius:9px;color:inherit!important;text-decoration:none!important;font-size:13px;font-weight:850;white-space:nowrap}' +
          '.novelight-admin-shortcut:hover{border-color:rgba(216,180,90,.95)}' +
          '@media(max-width:900px){body.novelight-public-header-page .novelight-admin-shortcut-desktop{display:none!important}}';
        document.head.appendChild(style);
      }

      const desktopTarget =
        document.querySelector('header .header-actions') ||
        document.querySelector('header .right') ||
        document.querySelector('header .actions') ||
        document.querySelector('header .header-inner');
      if (desktopTarget) {
        const link = document.createElement('a');
        link.href = 'admin.html';
        link.textContent = '管理画面';
        link.className =
          'novelight-admin-shortcut novelight-admin-shortcut-desktop';
        link.setAttribute('aria-label', 'NOVELIGHT管理画面を開く');
        const mobileMenu = desktopTarget.querySelector('details.mobile-menu');
        desktopTarget.insertBefore(link, mobileMenu || null);
      }

      const mobileNav = document.querySelector('details.mobile-menu nav');
      if (mobileNav) {
        const link = document.createElement('a');
        link.href = 'admin.html';
        link.textContent = '管理画面';
        link.className =
          'novelight-admin-shortcut novelight-admin-shortcut-mobile';
        mobileNav.appendChild(link);
      }
      return Boolean(desktopTarget || mobileNav);
    } catch (error) {
      console.error('Admin shortcut lookup failed', error);
      return false;
    }
  }

  function watch(client) {
    if (!client || window.__novelightScoutTitleToastWatcherInstalled) return;
    window.__novelightScoutTitleToastWatcherInstalled = true;

    const monitorState =
      window.__novelightScoutTitleToastMonitor ||
      (window.__novelightScoutTitleToastMonitor = {
        timer: 0,
        inFlight: false,
        listenersInstalled: false
      });

    const check = async () => {
      if (monitorState.inFlight || document.visibilityState !== 'visible') return;
      monitorState.inFlight = true;
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session?.access_token || !data.session.user?.id)
          return;

        void installAdminShortcut(data.session);

        const userId = data.session.user.id;
        const key = CURSOR_PREFIX + userId;
        let since = memoryCursors.get(userId) || storageGet(key);
        if (!since || Number.isNaN(new Date(since).getTime())) {
          since = new Date(
            Date.now() - SCOUT_TITLE_TOAST_VISIBLE_MS
          ).toISOString();
        }

        const response = await fetch(
          '/api/scout-badge-awards?since=' + encodeURIComponent(since),
          {
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              Authorization: 'Bearer ' + data.session.access_token
            }
          }
        );
        if (!response.ok) return;

        const payload = await response.json();
        const awards = Array.isArray(payload?.awards) ? payload.awards : [];
        awards.forEach(showToast);

        const cursor =
          typeof payload?.cursor === 'string' &&
          !Number.isNaN(new Date(payload.cursor).getTime())
            ? payload.cursor
            : since;
        memoryCursors.set(userId, cursor);
        storageSet(key, cursor);
      } catch (error) {
        console.error('Scout title earned toast lookup failed', error);
      } finally {
        monitorState.inFlight = false;
      }
    };

    const stopFallbackTimer = () => {
      if (!monitorState.timer) return;
      window.clearInterval(monitorState.timer);
      monitorState.timer = 0;
    };

    const startFallbackTimer = () => {
      if (
        document.visibilityState !== 'visible' ||
        monitorState.timer
      ) {
        return;
      }
      monitorState.timer = window.setInterval(
        () => void check(),
        SCOUT_TITLE_TOAST_FALLBACK_POLL_MS
      );
    };

    if (!monitorState.listenersInstalled) {
      monitorState.listenersInstalled = true;
      window.addEventListener('focus', () => {
        void check();
        startFallbackTimer();
      });
      window.addEventListener(SCOUT_RECORD_UPDATED_EVENT, () => void check());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
          stopFallbackTimer();
          return;
        }
        void check();
        startFallbackTimer();
      });
    }

    void check();
    startFallbackTimer();
  }

  function buildOptimizedAssetUrl(originalUrl, width = 128) {
    const value = String(originalUrl || '').trim();
    if (!value || value.startsWith('/_vercel/image?')) return value;
    return (
      '/_vercel/image?url=' +
      encodeURIComponent(value.startsWith('assets/') ? '/' + value : value) +
      '&w=' +
      encodeURIComponent(String(width)) +
      '&q=85'
    );
  }

  function installMypageActivityImageOptimization() {
    const page = (window.location.pathname.split('/').pop() || 'index.html')
      .replace(/\.html$/u, '')
      .toLowerCase();
    if (page !== 'mypage' || window.__novelightActivityImageOptimizationInstalled)
      return false;

    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src'
    );
    if (!descriptor?.get || !descriptor?.set || descriptor.configurable === false)
      return false;

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        const original = String(value || '').trim();
        if (this.classList?.contains('activity-icon') && original) {
          this.dataset.originalSrc = original;
          this.width = 46;
          this.height = 46;
          this.loading = 'lazy';
          this.decoding = 'async';
          this.fetchPriority = 'low';
          descriptor.set.call(this, buildOptimizedAssetUrl(original, 128));
          return;
        }
        descriptor.set.call(this, value);
      }
    });
    window.__novelightActivityImageOptimizationInstalled = true;
    return true;
  }

  function installClientHook() {
    if (
      window.__novelightScoutTitleToastClientHookInstalled ||
      window.__novelightScoutTitleToastCaptureInstalled ||
      !window.supabase ||
      typeof window.supabase.createClient !== 'function'
    ) {
      return;
    }

    const createClient = window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient = function (...args) {
      const client = createClient(...args);
      watch(client);
      return client;
    };
    window.__novelightScoutTitleToastClientHookInstalled = true;
  }

  function installHelpRuntime() {
    if (
      window.NovelightHelp?.version ||
      document.querySelector('script[data-novelight-help-runtime]')
    ) {
      return false;
    }
    const script = document.createElement('script');
    script.src = 'novelight-help.js';
    script.defer = true;
    script.dataset.novelightHelpRuntime = 'shared';
    document.head.appendChild(script);
    return true;
  }

  function installPublicShareRuntime() {
    const page = (window.location.pathname.split('/').pop() || 'index.html')
      .replace(/\.html$/u, '')
      .toLowerCase();
    if (
      !['my-novels', 'novel', 'episode'].includes(page) ||
      document.querySelector('script[data-novelight-public-share-runtime]')
    ) {
      return false;
    }
    const script = document.createElement('script');
    script.src = 'novelight-public-share.js';
    script.defer = true;
    script.dataset.novelightPublicShareRuntime = 'shared';
    document.head.appendChild(script);
    return true;
  }

  installMypageActivityImageOptimization();
  window.__novelightAttachScoutTitleToastWatcher = watch;
  const pendingClients = Array.isArray(
    window.__novelightScoutTitleToastPendingClients
  )
    ? window.__novelightScoutTitleToastPendingClients
    : [];
  pendingClients.forEach((client) => watch(client));
  installHelpRuntime();
  installPublicShareRuntime();
  installClientHook();
})();