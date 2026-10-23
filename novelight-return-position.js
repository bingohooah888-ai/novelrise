/* Recover a reader's place on browser Back even when Home shelves or the
   work-detail table of contents changes height after the first paint. */
(() => {
  'use strict';
  const page = location.pathname.split('/').pop() || 'index.html';
  if (page !== 'index.html' && page !== 'novel.html') return;

  const STATE_KEY = '__novelightReturnPositionV1';
  const VIEWPOINT = 120;
  const returning = performance.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward';
  const selector = page === 'index.html'
    ? 'main > section'
    : 'main > section, main > div, main > aside';
  const tocSelector = '.nl-work-detail-toc .nl-work-toc-list, .nl-worknav-episode-list';

  function visibleAnchor() {
    const candidates = document.querySelectorAll(selector);
    let index = -1;
    let chosen = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const element = candidates[i];
      if (element.hidden) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.top > VIEWPOINT) continue;
      index = i;
      chosen = rect;
      if (rect.bottom > VIEWPOINT) break;
    }
    return chosen ? { index, distance: VIEWPOINT - chosen.top } : null;
  }

  function remember() {
    const previous = history.state;
    if (previous !== null && (typeof previous !== 'object' || Array.isArray(previous))) return;
    const toc = document.querySelector(tocSelector);
    const snapshot = {
      pathname: location.pathname,
      search: location.search,
      top: window.scrollY,
      anchor: visibleAnchor(),
      tocTop: toc ? toc.scrollTop : null
    };
    try {
      history.replaceState({ ...previous, [STATE_KEY]: snapshot }, '');
    } catch (error) {
      console.warn('Page return position could not be saved', error);
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link?.href) remember();
  }, true);
  window.addEventListener('pagehide', remember);

  const snapshot = history.state?.[STATE_KEY];
  if (!returning || !snapshot || snapshot.pathname !== location.pathname
      || snapshot.search !== location.search || !Number.isFinite(snapshot.top)) return;

  try { history.scrollRestoration = 'manual'; } catch (_) { /* default browser behavior */ }
  let userInteracted = false;
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, () => { userInteracted = true; }, { once: true, passive: true });
  }

  function restore() {
    if (userInteracted) return;
    let target = snapshot.top;
    const anchor = snapshot.anchor;
    if (anchor && Number.isInteger(anchor.index) && Number.isFinite(anchor.distance)) {
      const element = document.querySelectorAll(selector)[anchor.index];
      if (element && !element.hidden) {
        const rect = element.getBoundingClientRect();
        if (rect.height > 0) {
          target = window.scrollY + rect.top + anchor.distance - VIEWPOINT;
        }
      }
    }
    window.scrollTo({ top: Math.max(0, target), left: 0, behavior: 'auto' });
    const toc = document.querySelector(tocSelector);
    if (toc && Number.isFinite(snapshot.tocTop)) toc.scrollTop = snapshot.tocTop;
  }

  const schedule = () => requestAnimationFrame(() => requestAnimationFrame(restore));
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('pageshow', schedule, { once: true });
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('novelight:page-content-ready', schedule);
})();
