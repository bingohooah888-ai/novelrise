(() => {
  'use strict';

  const TABLE = 'reader_bookshelf_entries';
  const PAGE_SIZE = 24;
  const STATES = Object.freeze({
    want_to_read: 'あとで読む',
    reading: '読書中',
    completed: '読了'
  });
  const client = window.client;
  const list = document.getElementById('list');
  if (!client || !list) return;

  const favoriteMap = new Map();
  const entryMap = new Map();
  const novelMap = new Map();
  let favoriteOffset = 0;
  let entryOffset = 0;
  let favoritesDone = false;
  let entriesDone = false;
  let shelfAvailable = true;
  let loading = false;
  let session = null;

  function isMissingBookshelfTable(error) {
    const code = String(error?.code || '');
    return code === '42P01' || code === 'PGRST204' || code === 'PGRST205';
  }

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = value ?? '';
    return node.innerHTML;
  }

  function validatePayload(values) {
    const readingState = String(values?.readingState || '');
    const listName = String(values?.listName || '').trim();
    const memo = String(values?.memo || '');
    if (!Object.hasOwn(STATES, readingState)) throw new Error('読書状態を選択してください。');
    if (listName.length > 60) throw new Error('自分用リスト名は60文字以内で入力してください。');
    if (memo.length > 1000) throw new Error('非公開メモは1000文字以内で入力してください。');
    return { reading_state: readingState, list_name: listName || null, memo };
  }

  function installStyles() {
    if (document.getElementById('novelight-bookshelf-page-style')) return;
    const style = document.createElement('style');
    style.id = 'novelight-bookshelf-page-style';
    style.textContent = `
      .nl-shelf-entry{display:grid;gap:9px}.nl-shelf-entry[hidden]{display:none}
      .nl-shelf-card{display:block}.nl-shelf-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .nl-shelf-badge{padding:4px 8px;border-radius:999px;background:#f2ece1;color:#6a5134;font-size:11px;font-weight:900}
      .nl-shelf-badge.favorite{background:#fff1cc;color:#805d08}
      .nl-shelf-organizer{padding:13px;border:1px solid #e3ddd2;border-radius:12px;background:#fffdf8}
      .nl-shelf-fields{display:grid;grid-template-columns:180px minmax(0,1fr);gap:9px}
      .nl-shelf-fields select,.nl-shelf-fields input,.nl-shelf-fields textarea{width:100%;padding:9px 10px;border:1px solid #d8d0c3;border-radius:8px;background:#fff;font:inherit}
      .nl-shelf-fields textarea{grid-column:1/-1;min-height:76px;resize:vertical}
      .nl-shelf-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:9px;flex-wrap:wrap}
      .nl-shelf-actions button{min-height:36px;padding:7px 12px;border:1px solid #cfc5b6;border-radius:8px;background:#fff;font-weight:900;cursor:pointer}
      .nl-shelf-actions .save{background:#3b2a1d;color:#fff;border-color:#3b2a1d}
      .nl-shelf-status{margin-right:auto;align-self:center;color:#75695d;font-size:11px}
      .nl-bookshelf-more-wrap{display:flex;justify-content:center;margin:22px 0 0}
      .nl-bookshelf-more{min-height:44px;padding:10px 18px;border:1px solid #6d4aff;border-radius:9px;background:#fff;color:#5d45d6;font-weight:900;cursor:pointer}
      .nl-bookshelf-more:disabled{opacity:.55;cursor:wait}
      @media(max-width:640px){.nl-shelf-fields{grid-template-columns:1fr}.nl-shelf-fields textarea{grid-column:auto}.nl-shelf-actions{flex-direction:column}.nl-shelf-actions button{width:100%}.nl-shelf-status{margin-right:0}}
    `;
    document.head.appendChild(style);
  }

  function stateOptions(selected) {
    const parts = [`<option value=""${selected ? '' : ' selected'}>状態を選ぶ</option>`];
    for (const [value, label] of Object.entries(STATES)) {
      parts.push(`<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`);
    }
    return parts.join('');
  }

  function organizerMarkup(entry) {
    return `<div class="nl-shelf-fields"><select class="nl-shelf-state" aria-label="読書状態">${stateOptions(entry?.reading_state || '')}</select><input class="nl-shelf-list-name" maxlength="60" placeholder="自分用リスト（例：休日に読む）" value="${escapeHtml(entry?.list_name || '')}"><textarea class="nl-shelf-memo" maxlength="1000" placeholder="自分だけに見えるメモ">${escapeHtml(entry?.memo || '')}</textarea></div><div class="nl-shelf-actions"><span class="nl-shelf-status">${entry ? '非公開で保存済み' : '未整理'}</span><button class="remove" type="button"${entry ? '' : ' disabled'}>本棚整理を解除</button><button class="save" type="button">保存</button></div>`;
  }

  function renderOrganizerState(article, entry) {
    article.dataset.state = entry?.reading_state || 'unorganized';
    article.dataset.list = entry?.list_name || '';
    const status = article.querySelector('.nl-shelf-status');
    if (status) status.textContent = entry ? '非公開で保存済み' : '未整理';
    const remove = article.querySelector('.remove');
    if (remove) remove.disabled = !entry;
    const badges = article.querySelector('.nl-shelf-badges');
    if (badges) {
      const favorite = article.dataset.favorite === 'true';
      badges.innerHTML = `${favorite ? '<span class="nl-shelf-badge favorite">★ お気に入り</span>' : ''}${entry ? `<span class="nl-shelf-badge">${escapeHtml(STATES[entry.reading_state])}</span>` : '<span class="nl-shelf-badge">未整理</span>'}${entry?.list_name ? `<span class="nl-shelf-badge">${escapeHtml(entry.list_name)}</span>` : ''}`;
    }
  }

  function workCard(novel, favorite, entry) {
    const article = document.createElement('article');
    article.className = 'nl-shelf-entry';
    article.dataset.novelId = String(novel.id);
    article.dataset.favorite = favorite ? 'true' : 'false';
    const link = document.createElement('a');
    link.className = 'card nl-shelf-card';
    link.href = `novel.html?id=${encodeURIComponent(novel.id)}`;
    link.innerHTML = `<span class="genre">${escapeHtml(novel.genre || '未設定')}</span><div class="title">${escapeHtml(novel.title)}</div><div class="desc">${escapeHtml(novel.description || '')}</div><div class="meta">👁 ${Number(novel.pv || 0).toLocaleString()} PV</div><div class="nl-shelf-badges"></div>`;
    const organizer = document.createElement('div');
    organizer.className = 'nl-shelf-organizer';
    organizer.innerHTML = organizerMarkup(entry);
    article.append(link, organizer);
    renderOrganizerState(article, entry);
    return article;
  }

  function readOrganizer(article) {
    return {
      readingState: article.querySelector('.nl-shelf-state')?.value || '',
      listName: article.querySelector('.nl-shelf-list-name')?.value || '',
      memo: article.querySelector('.nl-shelf-memo')?.value || ''
    };
  }

  async function saveEntry(novelId, values) {
    const payload = validatePayload(values);
    const result = await client.from(TABLE).upsert({ user_id: session.user.id, novel_id: novelId, ...payload }, { onConflict: 'user_id,novel_id' }).select('user_id,novel_id,reading_state,list_name,memo,created_at,updated_at').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function deleteEntry(novelId) {
    const result = await client.from(TABLE).delete().eq('user_id', session.user.id).eq('novel_id', novelId);
    if (result.error) throw result.error;
  }

  async function fetchFavoritesPage() {
    if (favoritesDone) return [];
    const result = await client.from('favorites').select('novel_id,created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }).range(favoriteOffset, favoriteOffset + PAGE_SIZE);
    if (result.error) throw result.error;
    const raw = result.data || [];
    const page = raw.slice(0, PAGE_SIZE);
    favoriteOffset += page.length;
    favoritesDone = raw.length <= PAGE_SIZE;
    return page;
  }

  async function fetchEntriesPage() {
    if (entriesDone || !shelfAvailable) return [];
    const result = await client.from(TABLE).select('user_id,novel_id,reading_state,list_name,memo,created_at,updated_at').eq('user_id', session.user.id).order('updated_at', { ascending: false }).range(entryOffset, entryOffset + PAGE_SIZE);
    if (result.error) {
      if (isMissingBookshelfTable(result.error)) {
        shelfAvailable = false;
        entriesDone = true;
        const warning = document.getElementById('bookshelfUnavailable');
        if (warning) warning.hidden = false;
        return [];
      }
      throw result.error;
    }
    const raw = result.data || [];
    const page = raw.slice(0, PAGE_SIZE);
    entryOffset += page.length;
    entriesDone = raw.length <= PAGE_SIZE;
    return page;
  }

  function sortLoadedIds() {
    return [...new Set([...favoriteMap.keys(), ...entryMap.keys()])].sort((left, right) => {
      const leftAt = Math.max(new Date(entryMap.get(left)?.updated_at || 0).getTime(), favoriteMap.get(left) || 0);
      const rightAt = Math.max(new Date(entryMap.get(right)?.updated_at || 0).getTime(), favoriteMap.get(right) || 0);
      return rightAt - leftAt;
    });
  }

  function refreshListFilter() {
    const select = document.getElementById('bookshelfListFilter');
    if (!select) return;
    const previous = select.value;
    const names = [...new Set([...entryMap.values()].map((entry) => entry.list_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    select.replaceChildren(new Option('すべての自分用リスト', 'all'));
    for (const name of names) select.add(new Option(name, name));
    select.value = names.includes(previous) ? previous : 'all';
  }

  function applyFilters() {
    const state = document.getElementById('bookshelfStateFilter')?.value || 'all';
    const listName = document.getElementById('bookshelfListFilter')?.value || 'all';
    let visible = 0;
    for (const article of list.querySelectorAll('.nl-shelf-entry')) {
      const stateMatch = state === 'all' || (state === 'favorites' && article.dataset.favorite === 'true') || article.dataset.state === state;
      const listMatch = listName === 'all' || article.dataset.list === listName;
      article.hidden = !(stateMatch && listMatch);
      if (!article.hidden) visible += 1;
    }
    const summary = document.getElementById('bookshelfSummary');
    if (summary) summary.textContent = `${visible}作品を表示中（${novelMap.size}作品を読み込み済み${favoritesDone && entriesDone ? '' : '・続きあり'}）`;
  }

  function wireArticle(article) {
    const novelId = article.dataset.novelId;
    if (!shelfAvailable) {
      article.querySelectorAll('input,textarea,select,button').forEach((control) => { control.disabled = true; });
      return;
    }
    const save = article.querySelector('.save');
    const remove = article.querySelector('.remove');
    save?.addEventListener('click', async () => {
      save.disabled = true;
      const status = article.querySelector('.nl-shelf-status');
      if (status) status.textContent = '保存中...';
      try {
        const entry = await saveEntry(novelId, readOrganizer(article));
        entryMap.set(novelId, entry);
        renderOrganizerState(article, entry);
        refreshListFilter();
        applyFilters();
      } catch (error) {
        console.error('bookshelf save failed', error);
        if (status) status.textContent = error?.message || '保存できませんでした';
      } finally {
        save.disabled = false;
      }
    });
    remove?.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await deleteEntry(novelId);
        entryMap.delete(novelId);
        if (article.dataset.favorite === 'true') {
          article.querySelector('.nl-shelf-state').value = '';
          article.querySelector('.nl-shelf-list-name').value = '';
          article.querySelector('.nl-shelf-memo').value = '';
          renderOrganizerState(article, null);
        } else {
          novelMap.delete(novelId);
          article.remove();
        }
        refreshListFilter();
        applyFilters();
      } catch (error) {
        console.error('bookshelf delete failed', error);
        const status = article.querySelector('.nl-shelf-status');
        if (status) status.textContent = '解除できませんでした';
        remove.disabled = false;
      }
    });
  }

  function renderLoaded() {
    const ids = sortLoadedIds();
    list.replaceChildren();
    for (const id of ids) {
      const novel = novelMap.get(id);
      if (!novel) continue;
      const article = workCard(novel, favoriteMap.has(id), entryMap.get(id) || null);
      list.appendChild(article);
      wireArticle(article);
    }
    if (!list.children.length) list.innerHTML = '<div class="empty">本棚はまだ空です。作品ページから「本棚に追加」またはお気に入り登録すると、ここで管理できます。</div>';
    refreshListFilter();
    applyFilters();
  }

  const moreWrap = document.createElement('div');
  moreWrap.className = 'nl-bookshelf-more-wrap';
  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'nl-bookshelf-more';
  moreButton.textContent = `さらに${PAGE_SIZE}作品読み込む`;
  moreWrap.appendChild(moreButton);
  list.insertAdjacentElement('afterend', moreWrap);

  async function loadNextPage() {
    if (loading || (favoritesDone && entriesDone)) return;
    loading = true;
    moreButton.disabled = true;
    moreButton.textContent = '続きを読み込み中...';
    try {
      const [favorites, entries] = await Promise.all([fetchFavoritesPage(), fetchEntriesPage()]);
      for (const row of favorites) favoriteMap.set(String(row.novel_id), new Date(row.created_at || 0).getTime());
      for (const entry of entries) entryMap.set(String(entry.novel_id), entry);
      const newIds = [...new Set([...favorites.map((row) => String(row.novel_id)), ...entries.map((row) => String(row.novel_id))])].filter((id) => !novelMap.has(id));
      if (newIds.length) {
        const novelsResult = await client.from('novels').select('id,title,genre,description,pv,status').in('id', newIds).eq('status', 'published');
        if (novelsResult.error) throw novelsResult.error;
        for (const novel of novelsResult.data || []) novelMap.set(String(novel.id), novel);
      }
      renderLoaded();
    } finally {
      loading = false;
      moreButton.disabled = false;
      moreButton.textContent = `さらに${PAGE_SIZE}作品読み込む`;
      moreWrap.hidden = favoritesDone && entriesDone;
    }
  }

  async function init() {
    installStyles();
    const auth = await client.auth.getSession();
    if (auth.error) throw auth.error;
    session = auth.data?.session || null;
    if (!session) {
      window.location.href = 'login.html?redirect=favorites.html';
      return;
    }
    void window.NovelightClient?.recordVisit?.(client);
    void window.NovelightClient?.claimAcquisition?.(client);
    document.getElementById('bookshelfStateFilter')?.addEventListener('change', applyFilters);
    document.getElementById('bookshelfListFilter')?.addEventListener('change', applyFilters);
    moreButton.addEventListener('click', () => void loadNextPage());
    await loadNextPage();
  }

  void init().catch((error) => {
    console.error('bookshelf page failed', error);
    list.innerHTML = '<div class="empty">本棚を表示できませんでした。通信状況を確認して、もう一度お試しください。</div>';
    moreWrap.hidden = true;
  });
})();
