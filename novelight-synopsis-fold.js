(() => {
  'use strict';

  const SELECTOR = '[data-novelight-synopsis]';
  const STYLE_ID = 'novelight-synopsis-fold-style';
  const toggles = new WeakMap();
  let nextId = 0;
  let refreshFrame = 0;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.nl-synopsis-copy{display:block;}',
      '.nl-synopsis-host:not(.is-expanded) .nl-synopsis-copy{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--nl-synopsis-lines,3);overflow:hidden;}',
      '.nl-synopsis-host.is-expanded .nl-synopsis-copy{display:block;overflow:visible;}',
      '.nl-synopsis-toggle{display:inline-flex;align-items:center;margin-top:4px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:800;line-height:1.5;cursor:pointer;text-decoration:underline;text-underline-offset:3px;opacity:.82;}',
      '.nl-synopsis-toggle:hover{opacity:1;}',
      '.nl-synopsis-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:3px;}',
      '.nl-synopsis-toggle[hidden]{display:none!important;}',
      '@media (max-width:600px){',
      'body.novelight-page-ranking .card{grid-template-columns:54px 70px minmax(0,1fr);column-gap:12px;row-gap:10px;}',
      'body.novelight-page-ranking .ranking-card-copy{display:contents;}',
      'body.novelight-page-ranking .rank{grid-column:1;grid-row:1 / 3;align-self:start;}',
      'body.novelight-page-ranking .card>.novel-cover-image,body.novelight-page-ranking .card>.novel-cover-placeholder{grid-column:2;grid-row:1 / 3;}',
      'body.novelight-page-ranking .ranking-card-copy>.genre{grid-column:3;grid-row:1;justify-self:start;align-self:start;}',
      'body.novelight-page-ranking .ranking-card-copy>.title{grid-column:3;grid-row:2;align-self:start;margin:0;}',
      'body.novelight-page-ranking .ranking-card-copy>.desc{grid-column:1 / -1;grid-row:3;min-width:0;margin:2px 0 0;font-size:17px;line-height:1.7;}',
      'body.novelight-page-ranking .ranking-card-copy>.desc+.nl-synopsis-toggle{grid-column:1 / -1;justify-self:start;}',
      'body.novelight-page-ranking .ranking-card-copy>.meta{grid-column:1 / -1;margin-top:0;}',
      'body.novelight-page-search .novel-card{grid-template-columns:76px minmax(0,1fr);column-gap:13px;row-gap:8px;}',
      'body.novelight-page-search .search-card-copy{display:contents;}',
      'body.novelight-page-search .novel-card>.novel-cover-image,body.novelight-page-search .novel-card>.novel-cover-placeholder{grid-column:1;grid-row:1 / 5;}',
      'body.novelight-page-search .search-card-copy>.badges{grid-column:2;grid-row:1;align-self:start;margin-bottom:0;}',
      'body.novelight-page-search .search-card-copy>.work-length{grid-column:2;grid-row:2;margin-bottom:0;}',
      'body.novelight-page-search .search-card-copy>.search-card-tags{grid-column:2;grid-row:3;margin:0;}',
      'body.novelight-page-search .search-card-copy>.title{grid-column:2;grid-row:4;align-self:start;margin:0;}',
      'body.novelight-page-search .search-card-copy>.description{grid-column:1 / -1;grid-row:5;min-width:0;margin:4px 0 0;font-size:17px;line-height:1.7;}',
      'body.novelight-page-search .search-card-copy>.description+.nl-synopsis-toggle{grid-column:1 / -1;justify-self:start;}',
      'body.novelight-page-search .search-card-copy>.natural-match-reason,body.novelight-page-search .search-card-copy>.meta{grid-column:1 / -1;}',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  function lineLimit(host) {
    const value = Number(host.dataset.novelightSynopsisLines || 3);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3;
  }

  function syncButton(host) {
    const button = toggles.get(host);
    if (!button) return;
    const expanded = host.classList.contains('is-expanded');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? '閉じる ▲' : 'あらすじをもっと見る ▼';
  }

  function refreshHost(host) {
    const copy = host.querySelector(':scope > .nl-synopsis-copy');
    const button = toggles.get(host);
    if (!copy || !button) return;

    const wasExpanded = host.classList.contains('is-expanded');
    if (wasExpanded) host.classList.remove('is-expanded');
    const overflow = copy.scrollHeight > copy.clientHeight + 1;
    button.hidden = !overflow;
    if (overflow && wasExpanded) host.classList.add('is-expanded');
    if (!overflow) host.classList.remove('is-expanded');
    host.dataset.novelightSynopsisOverflow = overflow ? 'true' : 'false';
    syncButton(host);
  }

  function scheduleRefresh() {
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      document.querySelectorAll(SELECTOR + '.nl-synopsis-host').forEach(refreshHost);
    });
  }

  function mount(host) {
    if (!(host instanceof HTMLElement)) return;
    if (host.dataset.novelightSynopsisMounted === 'true') return;
    host.dataset.novelightSynopsisMounted = 'true';
    host.classList.add('nl-synopsis-host');
    host.style.setProperty('--nl-synopsis-lines', String(lineLimit(host)));

    const copy = document.createElement('span');
    copy.className = 'nl-synopsis-copy';
    copy.id = 'novelight-synopsis-copy-' + String(++nextId);
    while (host.firstChild) copy.appendChild(host.firstChild);
    host.appendChild(copy);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nl-synopsis-toggle';
    button.hidden = true;
    button.setAttribute('aria-controls', copy.id);
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'あらすじをもっと見る ▼';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (host.dataset.novelightSynopsisOverflow !== 'true') return;
      host.classList.toggle('is-expanded');
      syncButton(host);
    });
    toggles.set(host, button);
    host.insertAdjacentElement('afterend', button);
    requestAnimationFrame(() => refreshHost(host));
  }

  function scan(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches(SELECTOR)) mount(root);
    root.querySelectorAll?.(SELECTOR).forEach(mount);
  }

  function boot() {
    installStyles();
    scan(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof Element) scan(added);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    if (document.fonts?.ready) {
      document.fonts.ready.then(scheduleRefresh).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
