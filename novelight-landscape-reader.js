(function attachNovelightLandscapeReader(global) {
  'use strict';

  // A one-shot handoff: immersive mode continues only when the reader follows Next.
  const NEXT_EPISODE_KEY = 'novelight:landscape-reader-next:v1';
  const LANDSCAPE_PHONE = '(orientation: landscape) and (pointer: coarse), (orientation: landscape) and (hover: none)';

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

    const hint = document.createElement('div');
    hint.id = 'nlLandscapeReaderHint';
    hint.className = 'nl-landscape-reader-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = 'スマホを横向きにしてください。横向きになると拡大表示します。';
    hint.hidden = true;
    document.body.appendChild(hint);

    let awaitingLandscape = false;
    let content = null;
    let active = false;
    let restoreSettings = null;
    let requestedEpisode = null;
    try {
      requestedEpisode = global.sessionStorage.getItem(NEXT_EPISODE_KEY);
      global.sessionStorage.removeItem(NEXT_EPISODE_KEY);
    } catch {
      // Private-browsing storage restrictions must not prevent normal reading.
    }
    const currentEpisode = new URLSearchParams(global.location.search).get('id');
    if (requestedEpisode !== currentEpisode) requestedEpisode = null;

    function syncButton() {
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? '拡大読書モードを終了' : '横画面で読書モードを拡大');
      button.textContent = active ? '⤡' : '⛶';
      button.title = active ? '通常の表示に戻る' : media.matches ? '読書画面を拡大' : 'スマホを横向きにして読書画面を拡大';
    }

    function syncEnd() {
      if (!active || !content) return;
      const maxScroll = Math.max(0, content.scrollWidth - content.clientWidth);
      const atEnd = Math.abs(content.scrollLeft) >= maxScroll - 3;
      document.body.dataset.landscapeReaderAtEnd = String(atEnd);
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
      if (active || !media.matches || !content?.isConnected) return;
      const progress = settings.contentProgress(content);
      restoreSettings = settings.load();
      settings.apply({ ...restoreSettings, writingMode: 'vertical' });
      document.body.dataset.landscapeReader = 'active';
      awaitingLandscape = false;
      hint.hidden = true;
      active = true;
      syncButton();
      restoreProgress(progress);
    }

    function exit() {
      if (!active) return;
      const progress = content?.isConnected ? settings.contentProgress(content) : 0;
      document.body.dataset.landscapeReader = 'off';
      delete document.body.dataset.landscapeReaderAtEnd;
      active = false;
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
          enter();
        }
      }
    }

    button.addEventListener('click', () => {
      if (active) {
        awaitingLandscape = false;
        hint.hidden = true;
        exit();
      } else if (media.matches) {
        enter();
      } else {
        // Mobile browsers cannot reliably force device rotation from a webpage.
        awaitingLandscape = true;
        hint.hidden = false;
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
    const onOrientationChange = () => {
      if (!media.matches && active) exit();
      if (media.matches && awaitingLandscape) enter();
      syncButton();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onOrientationChange);
    else media.addListener?.(onOrientationChange);

    const observer = new MutationObserver(syncContent);
    observer.observe(card, { childList: true });
    syncButton();
    syncContent();
  }

  global.NovelightLandscapeReader = Object.freeze({ mount });
})(window);
