(function () {
  'use strict';

  const VISITOR_KEY = 'novelight_visitor_token';
  const TRAFFIC_KEY = 'novelight_first_touch';
  const TOUCH_SESSION_KEY = 'novelight_touch_recorded';
  let memoryVisitorToken = null;

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
    syncAuthHeader
  };
})();
