// R15 work labels and local hide preference in general discovery lists.
(() => {
  'use strict';

  const KEY = 'novelight:hide-r15-discovery';
  const SELECTOR = 'a[href*="novel.html?id="]';
  const CONTROL_PAGES = new Set(['search.html', 'ranking.html', 'recommended.html', 'new-arrivals.html']);
  const known = new Map();
  const inFlight = new Set();
  let client;
  let scheduled = false;

  function pref() {
    try { return localStorage.getItem(KEY) === '1'; }
    catch { return false; }
  }
  function save(value) {
    try { localStorage.setItem(KEY, value ? '1' : '0'); }
    catch (error) { console.warn('R15 setting unavailable', error); }
    schedule();
  }
  function idOf(anchor) {
    try { return new URL(anchor.href).searchParams.get('id'); }
    catch { return null; }
  }
  function addBadge(anchor) {
    if (anchor.querySelector('.nl-r15-badge')) return;
    if ([...anchor.querySelectorAll('.mature')].some(node => node.textContent === 'R15')) return;
    const badge = document.createElement('span');
    badge.className = 'nl-r15-badge';
    badge.textContent = 'R15';
    badge.setAttribute('aria-label', '15歳以上向け・内容注意あり');
    (anchor.querySelector('.badges, .card-copy, .search-card-copy, .zone-copy, .copy') || anchor).prepend(badge);
  }
  function apply(anchor, rating) {
    const r15 = rating === 'sensitive_15' || rating === 'mature';
    if (r15) addBadge(anchor);
    anchor.hidden = pref() && r15;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; scan(); });
  }
  async function lookup(ids) {
    ids.forEach(id => inFlight.add(id));
    try {
      const result = await client.rpc('novelight_search_card_metadata', { p_novel_ids: ids });
      if (result.error) throw result.error;
      const mapped = new Map((result.data || []).map(row => [String(row.novel_id), row.content_rating]));
      ids.forEach(id => known.set(id, mapped.get(id) || null));
      schedule();
    } catch (error) {
      console.error('R15 listing labels unavailable', error);
      const note = document.getElementById('nl-r15-status');
      if (note) note.textContent = '作品区分の確認に失敗したため、一部を絞り込めません。';
    } finally {
      ids.forEach(id => inFlight.delete(id));
    }
  }
  function scan() {
    if (!client) return;
    const unknown = new Set();
    for (const a of document.querySelectorAll(SELECTOR)) {
      const id = idOf(a);
      if (!id || !/^[0-9]+$/u.test(id)) continue;
      if (known.has(id)) apply(a, known.get(id));
      else if (!inFlight.has(id)) unknown.add(id);
    }
    const ids = [...unknown];
    for (let i = 0; i < ids.length; i += 50) void lookup(ids.slice(i, i + 50));
  }
  function mountControl() {
    const page = location.pathname.split('/').pop();
    if (!CONTROL_PAGES.has(page)) return;
    const after = document.getElementById('searchArea') || document.querySelector('main h1');
    if (!after || document.getElementById('nl-r15-filter')) return;
    const wrap = document.createElement('div');
    wrap.className = 'nl-r15-filter-wrap';
    const label = document.createElement('label');
    label.id = 'nl-r15-filter';
    label.className = 'nl-r15-filter';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = pref();
    input.addEventListener('change', () => save(input.checked));
    label.append(input, document.createTextNode('R15作品を表示しない'));
    const note = document.createElement('small');
    note.id = 'nl-r15-status';
    note.textContent = 'この端末の作品一覧に適用されます。';
    wrap.append(label, note);
    after.insertAdjacentElement('afterend', wrap);
  }
  function start() {
    if (!window.supabase?.createClient) return;
    client = window.supabase.createClient(
      'https://fiepaguycecrredwrcwx.supabase.co',
      'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
    );
    const style = document.createElement('style');
    style.textContent =
      '.nl-r15-badge{display:inline-flex;align-items:center;width:max-content;margin:0 6px 4px 0;padding:3px 8px;border-radius:6px;background:#fff0ce;color:#764e0b;font-size:11px;font-weight:800}' +
      '.nl-r15-filter-wrap{margin:12px 0 18px;font-size:13px;color:inherit}' +
      '.nl-r15-filter{display:inline-flex;align-items:center;gap:8px;font-weight:750;cursor:pointer}' +
      '.nl-r15-filter input{width:auto;min-width:16px;height:16px;accent-color:#a17427}' +
      '.nl-r15-filter-wrap small{display:block;margin-top:3px;opacity:.75}' +
      'a[href*="novel.html?id="][hidden]{display:none!important}';
    document.head.appendChild(style);
    mountControl();
    new MutationObserver(schedule).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    window.addEventListener('storage', event => {
      if (event.key !== KEY) return;
      const control = document.querySelector('#nl-r15-filter input');
      if (control) control.checked = pref();
      schedule();
    });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
