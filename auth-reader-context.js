(function (global) {
  'use strict';

  const STORAGE_KEY = 'novelight:pending-auth-reader-context:v1';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_TARGET = 'mypage.html';
  const HOME_RESUME_SCRIPT_ID = 'novelight-home-resume-loader';
  const HOME_UPDATES_SCRIPT_ID = 'novelight-home-updates-loader';
  const ALLOWED_PATHS = new Set([
    '/mypage.html',
    '/pricing.html',
    '/scout-record.html',
    '/post.html',
    '/favorites.html',
    '/updates.html',
    '/author.html',
    '/novel.html',
    '/novel-edit.html',
    '/episode.html',
    '/episode-post.html',
    '/episode-edit.html',
    '/episode-schedule.html',
    '/analytics.html',
    '/my-novels.html',
    '/admin.html',
    '/admin-announcements.html',
    '/admin-inquiries.html',
    '/admin-reports.html',
    '/admin-beta-authors.html'
  ]);

  function safeRedirectTarget(raw, fallback = DEFAULT_TARGET) {
    const fallbackTarget = typeof fallback === 'string' && fallback ? fallback : DEFAULT_TARGET;
    if (!raw) return fallbackTarget;
    try {
      const url = new URL(raw, global.location.origin);
      if (url.origin !== global.location.origin) return fallbackTarget;
      if (!ALLOWED_PATHS.has(url.pathname)) return fallbackTarget;
      return url.pathname.replace(/^\//, '') + url.search;
    } catch {
      return fallbackTarget;
    }
  }

  function currentRedirect() {
    return new URLSearchParams(global.location.search).get('redirect');
  }

  function authHref(page, raw) {
    if (!raw) return page;
    const url = new URL(page, global.location.origin);
    url.searchParams.set('redirect', safeRedirectTarget(raw));
    return url.pathname.replace(/^\//, '') + url.search;
  }

  function removePendingTarget() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('auth reader context cleanup failed', error);
    }
  }

  function rememberPendingTarget(raw) {
    if (!raw) return null;
    const target = safeRedirectTarget(raw);
    try {
      global.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ target, expiresAt: Date.now() + MAX_AGE_MS })
      );
    } catch (error) {
      console.warn('auth reader context storage failed', error);
    }
    return target;
  }

  function readPendingTarget(remove = false) {
    let stored;
    try {
      stored = global.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('auth reader context read failed', error);
      return null;
    }
    if (!stored) return null;

    try {
      const record = JSON.parse(stored);
      if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
        removePendingTarget();
        return null;
      }
      const target = safeRedirectTarget(record.target);
      if (remove) removePendingTarget();
      return target;
    } catch {
      removePendingTarget();
      return null;
    }
  }

  function consumePendingTarget() {
    return readPendingTarget(true);
  }

  function isSignupConfirmationReturn() {
    const hash = new URLSearchParams(global.location.hash.replace(/^#/, ''));
    return hash.get('type') === 'signup';
  }

  async function resumePendingSignupContext(client) {
    if (!client?.auth || !isSignupConfirmationReturn()) return false;
    if (!readPendingTarget(false)) return false;

    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session) return false;
      const target = consumePendingTarget();
      if (!target) return false;
      global.location.replace(target);
      return true;
    } catch (error) {
      console.error('auth reader context resume failed', error);
      return false;
    }
  }

  function scheduleHomeResumeEnhancement() {
    const document = global.document;
    const pathname = String(global.location?.pathname || '');
    const isHome = pathname === '/' || pathname.endsWith('/index.html');
    if (!document || !isHome) return false;

    const loadScript = (id, src) => {
      if (document.getElementById(id)) return;
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      (document.body || document.head || document.documentElement)?.appendChild(script);
    };

    const load = () => {
      loadScript(HOME_RESUME_SCRIPT_ID, 'novelight-home-resume.js');
      loadScript(HOME_UPDATES_SCRIPT_ID, 'novelight-favorite-updates.js');
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', load, { once: true });
    } else {
      load();
    }
    return true;
  }

  global.NovelightAuthReturn = Object.freeze({
    safeRedirectTarget,
    currentRedirect,
    authHref,
    rememberPendingTarget,
    consumePendingTarget,
    resumePendingSignupContext
  });

  scheduleHomeResumeEnhancement();
})(window);