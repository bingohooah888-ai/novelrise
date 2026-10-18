(function attachNovelightLandscapeReader(global) {
  'use strict';

  const NEXT_EPISODE_KEY = 'novelight:landscape-reader-next:v1';
  const LANDSCAPE_PHONE = '(orientation: landscape) and (pointer: coarse), (orientation: landscape) and (hover: none), (orientation: landscape) and (max-height: 600px)';

  function mount() {
    const settings = global.NovelightReadingSettings;
    const card = document.getElementById('card');
    const media = typeof global.matchMedia === 'function' ? global.matchMedia(LANDSCAPE_PHONE) : null;
    if (!settings || !card || !media || document.getElementById('nlLandscapeReaderToggle')) return;

    const button = document.createElement('button');
    button.id = 'nlLandscapeReaderToggle';
    button.type = 'button';
    button.className = 'nl-landscape-reader-toggle';
    document.body.appendChild(button);

    let content = null;
    let active = false;
    let restoreSettings = null;
    let nativeLandscapeLocked = false;
    let requestedFullscreen = false;
    let requestGeneration = 0;
    let requestedEpisode = null;
    try {
      requestedEpisode = global.sessionStorage.getItem(NEXT_EPISODE_KEY);
      global.sessionStorage.removeItem(NEXT_EPISODE_KEY);
    } catch {
      // Reading remains available when storage is disabled.
    }
    const currentEpisode = new URLSearchParams(global.location.search).get('id');
    if (requestedEpisode !== currentEpisode) requestedEpisode = null;

    function syncButton() {
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? '拡大読書モードを終了' : '横画面で読書モードを拡大');
      button.textContent = active ? '⤡' : '⛶';
      button.title = active ? '通常の表示に戻る' : '横画面で拡大読書';
    }

    function syncViewport() {
      if (!active) return;
      const portraitViewport = global.innerHeight > global.innerWidth;
      document.body.dataset.landscapeReaderRotated = String(portraitViewport && !nativeLandscapeLocked);
    }

    function syncEnd() {
      if (!active || !content) return;
      const maxScroll = Math.max(0, content.scrollWidth - content.clientWidth);
      document.body.dataset.landscapeReaderAtEnd =
        String(Math.abs(content.scrollLeft) >= maxScroll - 3);
    }

    function restoreProgress(progress) {
      global.requestAnimationFrame(() => {
        if (!content?.isConnected) return;
        settings.seekProgress(content, progress);
        syncEnd();
        document.dispatchEvent(new Event('novelight-reading-mode-changed'));
      });
    }

    function enter() {
      if (active || !content?.isConnected) return;
      const progress = settings.contentProgress(content);
      restoreSettings = settings.load();
      settings.apply({ ...restoreSettings, writingMode: 'vertical' });
      nativeLandscapeLocked = false;
      document.body.dataset.landscapeReader = 'active';
      active = true;
      syncViewport();
      syncButton();
      restoreProgress(progress);
    }

    async function requestNativeLandscape() {
      const generation = ++requestGeneration;
      try {
        if (typeof document.documentElement?.requestFullscreen === 'function') {
          // Call requestFullscreen while the user gesture is still active.
          await document.documentElement.requestFullscreen();
          if (!active || generation !== requestGeneration) return;
          requestedFullscreen = document.fullscreenElement === document.documentElement;
        }
      } catch {
        // Unsupported fullscreen, such as some iPhone browsers: use CSS rotation.
      }

      if (!active || generation !== requestGeneration) return;
      if (requestedFullscreen && typeof global.screen?.orientation?.lock === 'function') {
        try {
          await global.screen.orientation.lock('landscape');
          if (!active || generation !== requestGeneration) return;
          nativeLandscapeLocked = true;
        } catch {
          // Browser or OS denied rotation: keep the CSS landscape view.
        }
      }
      if (active && generation === requestGeneration) {
        syncViewport();
        restoreProgress(settings.contentProgress(content));
      }
    }

    function exit() {
      if (!active) return;
      ++requestGeneration; // Ignore late resolution from fullscreen/orientation APIs.
      const progress = content?.isConnected ? settings.contentProgress(content) : 0;
      document.body.dataset.landscapeReader = 'off';
      delete document.body.dataset.landscapeReaderAtEnd;
      delete document.body.dataset.landscapeReaderRotated;
      active = false;
      if (nativeLandscapeLocked) {
        try {
          global.screen?.orientation?.unlock?.();
        } catch {
          // Orientation may already have been released by the browser.
        }
      }
      nativeLandscapeLocked = false;
      if (requestedFullscreen && document.fullscreenElement === document.documentElement) {
        try {
          const leaving = document.exitFullscreen?.();
          leaving?.catch?.(() => {});
        } catch {
          // Normal reading remains available if the browser refuses to exit.
        }
      }
      requestedFullscreen = false;
      settings.apply(restoreSettings || settings.load());
      restoreSettings = null;
      syncButton();
      if (content?.isConnected) restoreProgress(progress);
    }

    function syncContent() {
      const next = card.querySelector('.content');
      if (next === content) return;
      content?.removeEventListener('scroll', syncEnd);
      if (active) exit();
      content = next;
      document.body.dataset.landscapeReaderReady = String(Boolean(content));
      if (content) {
        content.addEventListener('scroll', syncEnd, { passive: true });
        if (requestedEpisode) {
          requestedEpisode = null;
          // Following Next is not a new user gesture; use a rotated reading
          // surface on portrait instead of attempting forbidden fullscreen.
          enter();
        }
      }
    }

    button.addEventListener('click', () => {
      if (active) {
        exit();
      } else {
        enter();
        if (active) void requestNativeLandscape();
      }
    });
    document.addEventListener('click', (event) => {
      if (!active) return;
      const nextLink = event.target?.closest?.('#nlReadingNav .nl-reading-link.next[href]');
      if (!nextLink) return;
      const target = new URL(nextLink.href, global.location.href).searchParams.get('id');
      if (!target) return;
      try {
        global.sessionStorage.setItem(NEXT_EPISODE_KEY, target);
      } catch {
        // Navigation remains available even if persistence is blocked.
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && active) exit();
    });
    document.addEventListener('fullscreenchange', () => {
      if (active && requestedFullscreen && !document.fullscreenElement) exit();
    });

    const onOrientationChange = () => {
      if (active) {
        syncViewport();
        restoreProgress(settings.contentProgress(content));
      }
      syncButton();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onOrientationChange);
    else media.addListener?.(onOrientationChange);
    global.addEventListener?.('resize', onOrientationChange);

    const observer = new MutationObserver(syncContent);
    observer.observe(card, { childList: true });
    syncButton();
    syncContent();
  }

  global.NovelightLandscapeReader = Object.freeze({ mount });
})(window);
