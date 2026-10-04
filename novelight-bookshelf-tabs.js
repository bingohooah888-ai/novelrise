(() => {
  'use strict';

  const slug = (window.location.pathname.split('/').pop() || 'index.html')
    .replace(/\.html$/u, '')
    .toLowerCase();
  if (slug !== 'favorites') return;

  const STYLE_ID = 'novelight-bookshelf-tabs-style';
  const BUTTON_SELECTOR = '[data-bookshelf-tab]';
  let activeTab = '';
  let updateIds = new Set();
  let internalChange = false;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-bookshelf-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
      .nl-bookshelf-tab{min-height:40px;padding:8px 14px;border:1px solid #d8d0c3;border-radius:999px;background:#fff;color:#4f463c;font:inherit;font-size:13px;font-weight:900;cursor:pointer}
      .nl-bookshelf-tab:hover{background:#fffaf0;border-color:#c9bda9}
      .nl-bookshelf-tab[aria-pressed="true"]{background:#3b2a1d;border-color:#3b2a1d;color:#fff}
      .nl-bookshelf-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin-left:5px;padding:0 6px;border-radius:999px;background:#d6a447;color:#18120d;font-size:10px;font-weight:950}
    `;
    document.head.appendChild(style);
  }

  const list = () => document.getElementById('list');
  const stateFilter = () => document.getElementById('bookshelfStateFilter');
  const listFilter = () => document.getElementById('bookshelfListFilter');
  const cards = () => [...(list()?.querySelectorAll('.nl-shelf-entry') || [])];

  function setPressed(value) {
    document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.bookshelfTab === value));
    });
  }

  function setSummary(count, label) {
    const summary = document.getElementById('bookshelfSummary');
    if (summary) summary.textContent = `${label} ${count}作品`;
  }

  function dispatchState(value) {
    const select = stateFilter();
    if (!select) return;
    internalChange = true;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    internalChange = false;
  }

  function applyUpdatesMask() {
    if (activeTab !== 'updates') return;
    const selectedList = listFilter()?.value || 'all';
    let visible = 0;
    for (const card of cards()) {
      const listMatch = selectedList === 'all' || card.dataset.list === selectedList;
      const show = updateIds.has(String(card.dataset.novelId || '')) && listMatch;
      card.hidden = !show;
      if (show) visible += 1;
    }
    setSummary(visible, '更新あり');
  }

  function applyTab(value) {
    activeTab = value;
    setPressed(value);
    if (value === 'favorites') return dispatchState('favorites');
    if (value === 'later') return dispatchState('want_to_read');
    if (value === 'updates') {
      dispatchState('all');
      queueMicrotask(applyUpdatesMask);
    }
  }

  async function loadUpdateIds() {
    if (!window.NovelightFavoriteUpdates || typeof client === 'undefined' || !client) {
      updateIds = new Set();
      return;
    }
    try {
      const result = await window.NovelightFavoriteUpdates.favoriteUpdates(client, {
        initialize: false
      });
      updateIds = new Set((result.updates || []).map((item) => String(item.novelId)));
    } catch (error) {
      console.error('bookshelf update tab failed', error);
      updateIds = new Set();
    }
    const badge = document.querySelector('[data-bookshelf-update-count]');
    if (badge) {
      badge.textContent = String(updateIds.size);
      badge.hidden = updateIds.size === 0;
    }
  }

  async function mount() {
    const tabs = document.querySelector('.nl-bookshelf-tabs');
    const targetList = list();
    if (!tabs || !targetList) return;
    installStyles();
    await loadUpdateIds();

    tabs.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
      button.addEventListener('click', () => applyTab(button.dataset.bookshelfTab || ''));
    });

    stateFilter()?.addEventListener('change', () => {
      if (internalChange) return;
      activeTab = '';
      setPressed('');
    });

    listFilter()?.addEventListener('change', () => {
      if (activeTab === 'updates') queueMicrotask(applyUpdatesMask);
    });

    const observer = new MutationObserver(() => {
      if (activeTab === 'updates') queueMicrotask(applyUpdatesMask);
    });
    observer.observe(targetList, { childList: true });

    const updateButton = tabs.querySelector('[data-bookshelf-tab="updates"]');
    if (updateButton && !updateButton.querySelector('[data-bookshelf-update-count]')) {
      const badge = document.createElement('span');
      badge.className = 'nl-bookshelf-tab-count';
      badge.dataset.bookshelfUpdateCount = '';
      badge.textContent = String(updateIds.size);
      badge.hidden = updateIds.size === 0;
      updateButton.appendChild(badge);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
  } else {
    void mount();
  }
})();
