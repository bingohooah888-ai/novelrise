/* Keep a reader's location when returning to Home or a work detail page.
 * Store a stable element ID and its viewport offset, never an array index.
 * The browser retains native scroll restoration, especially for BFCache. */
(() => {
  'use strict';
  const page = location.pathname.split('/').pop() || 'index.html';
  if (page !== 'index.html' && page !== 'novel.html') return;

  const STATE_KEY = '__novelightReturnPositionV1';
  const VIEWPOINT = 120;
  const isBackForward =
    performance.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward';
  const anchorSelector = page === 'index.html'
    ? 'main > section[id]'
    : 'main > section[id], main > #novelightWorkDetailGrid';
  const tocSelector = '.nl-work-detail-toc .nl-work-toc-list, .nl-worknav-episode-list';

  function visible(element) {
    return element && !element.hidden && element.getClientRects().length > 0;
  }

  function stableAnchor() {
    let nearest = null;
    let nearestTop = -Infinity;
    for (const element of document.querySelectorAll(anchorSelector)) {
      if (!element.id || !visible(element)) continue;
      const top = element.getBoundingClientRect().top;
      if (top <= VIEWPOINT && top > nearestTop) {
        nearest = element;
        nearestTop = top;
      }
    }
    return nearest ? { id: nearest.id, viewportTop: nearestTop } : null;
  }

  function remember() {
    const state = history.state;
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) return;
    const toc = document.querySelector(tocSelector);
    const snapshot = {
      pathname: location.pathname,
      search: location.search,
      top: window.scrollY,
      anchor: stableAnchor(),
      tocTop: toc ? toc.scrollTop : null
    };
    try {
      history.replaceState({ ...state, [STATE_KEY]: snapshot }, '');
    } catch (error) {
      console.warn('NOVELIGHT return position save failed', error);
    }
  }

  // Save before following a normal link as well as on pagehide.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link?.href && !event.defaultPrevented) remember();
  }, true);
  window.addEventListener('pagehide', remember);

  const saved = history.state?.[STATE_KEY];
  if (!isBackForward || !saved ||
      saved.pathname !== location.pathname || saved.search !== location.search ||
      !Number.isFinite(saved.top) || saved.top < 0) return;

  // Do not turn off native restoration; Chrome/Safari BFCache needs it.
  let completed = false;
  let userInteracted = false;
  for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(name, () => { userInteracted = true; }, { passive: true, once: true });
  }

  function restore(fallback = false) {
    if (completed || userInteracted) return;
    const anchor = saved.anchor;

    // The legacy header is replaced with a grid asynchronously. Do not
    // restore while the old shell is still on screen.
    if (!fallback && page === 'novel.html' &&
        window.NovelightNovelDetailV2 && document.getElementById('novelHeader')) return;

    let target = saved.top;
    if (anchor?.id && Number.isFinite(anchor.viewportTop)) {
      const element = document.getElementById(anchor.id);
      if (!visible(element)) {
        if (!fallback) return;
      } else {
        const documentTop = window.scrollY + element.getBoundingClientRect().top;
        target = documentTop - anchor.viewportTop;
      }
    }
    const toc = document.querySelector(tocSelector);
    if (!fallback && Number.isFinite(saved.tocTop) && !toc) return;

    window.scrollTo({ top: Math.max(0, target), left: 0, behavior: 'auto' });
    if (toc && Number.isFinite(saved.tocTop)) toc.scrollTop = saved.tocTop;
    completed = true;
  }

  function schedule(fallback = false) {
    requestAnimationFrame(() => requestAnimationFrame(() => restore(fallback)));
  }

  // The async content-ready signal is emitted after shelf and detail assembly.
  // Avoid an earlier DOMContentLoaded/load restoration that visibly jumps.
  window.addEventListener('novelight:page-content-ready', () => schedule(), { once: false });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      // A restored BFCache document already retains its exact scroll position.
      completed = true;
      return;
    }
    if (!saved.anchor) schedule();
  }, { once: true });
  // Safety fallback for empty/failed/very slow feeds that never emit ready.
  window.addEventListener('load', () => {
    window.setTimeout(() => schedule(true), 3500);
  }, { once: true });
})();
