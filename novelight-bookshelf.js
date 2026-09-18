(function () {
  'use strict';

  const TABLE = 'reader_bookshelf_entries';
  const STYLE_ID = 'novelight-bookshelf-style';
  const STATES = Object.freeze({
    want_to_read: 'あとで読む',
    reading: '読書中',
    completed: '読了'
  });

  function pageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function isMissingBookshelfTable(error) {
    const code = String(error?.code || '');
    return code === '42P01' || code === 'PGRST204' || code === 'PGRST205';
  }
  function validatePayload(values) {
    const readingState = String(values?.readingState || '');
    const listName = String(values?.listName || '').trim();
    const memo = String(values?.memo || '');
    if (!Object.hasOwn(STATES, readingState)) {
      throw new Error('読書状態を選択してください。');
    }
    if (listName.length > 60) {
      throw new Error('自分用リスト名は60文字以内で入力してください。');
    }
    if (memo.length > 1000) {
      throw new Error('非公開メモは1000文字以内で入力してください。');
    }
    return {
      reading_state: readingState,
      list_name: listName || null,
      memo
    };
  }

  async function currentSession(clientInstance) {
    const result = await clientInstance.auth.getSession();
    if (result.error) throw result.error;
    return result.data?.session || null;
  }
  async function loadEntries(clientInstance, userId) {
    const result = await clientInstance
      .from(TABLE)
      .select(
        'user_id,novel_id,reading_state,list_name,memo,created_at,updated_at'
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (result.error) {
      if (isMissingBookshelfTable(result.error)) {
        return { available: false, entries: [] };
      }
      throw result.error;
    }
    return { available: true, entries: result.data || [] };
  }

  async function loadEntry(clientInstance, userId, novelId) {
    const result = await clientInstance
      .from(TABLE)
      .select(
        'user_id,novel_id,reading_state,list_name,memo,created_at,updated_at'
      )
      .eq('user_id', userId)
      .eq('novel_id', novelId)
      .maybeSingle();
    if (result.error) {
      if (isMissingBookshelfTable(result.error))
        return { available: false, entry: null };
      throw result.error;
    }
    return { available: true, entry: result.data || null };
  }
  async function saveEntry(clientInstance, userId, novelId, values) {
    const payload = validatePayload(values);
    const result = await clientInstance
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          novel_id: novelId,
          ...payload
        },
        { onConflict: 'user_id,novel_id' }
      )
      .select(
        'user_id,novel_id,reading_state,list_name,memo,created_at,updated_at'
      )
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function deleteEntry(clientInstance, userId, novelId) {
    const result = await clientInstance
      .from(TABLE)
      .delete()
      .eq('user_id', userId)
      .eq('novel_id', novelId);
    if (result.error) throw result.error;
    return true;
  }

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = value ?? '';
    return node.innerHTML;
  }
  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-bookshelf-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 18px}
      .nl-bookshelf-toolbar label{display:grid;gap:6px;color:#6f6254;font-size:12px;font-weight:800}
      .nl-bookshelf-toolbar select{min-height:42px;padding:8px 10px;border:1px solid #d9d2c7;border-radius:9px;background:#fff}
      .nl-bookshelf-summary{grid-column:1/-1;color:#74695c;font-size:12px}
      .nl-shelf-entry{display:grid;gap:9px}.nl-shelf-entry[hidden]{display:none}
      .nl-shelf-card{display:block}.nl-shelf-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .nl-shelf-badge{padding:4px 8px;border-radius:999px;background:#f2ece1;color:#6a5134;font-size:11px;font-weight:900}
      .nl-shelf-badge.favorite{background:#fff1cc;color:#805d08}
      .nl-shelf-organizer,.nl-book-panel{padding:13px;border:1px solid #e3ddd2;border-radius:12px;background:#fffdf8}
      .nl-shelf-fields{display:grid;grid-template-columns:180px minmax(0,1fr);gap:9px}
      .nl-shelf-fields select,.nl-shelf-fields input,.nl-shelf-fields textarea{width:100%;padding:9px 10px;border:1px solid #d8d0c3;border-radius:8px;background:#fff;font:inherit}
      .nl-shelf-fields textarea{grid-column:1/-1;min-height:76px;resize:vertical}
      .nl-shelf-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:9px;flex-wrap:wrap}
      .nl-shelf-actions button,.nl-book-control-button{min-height:36px;padding:7px 12px;border:1px solid #cfc5b6;border-radius:8px;background:#fff;font-weight:900;cursor:pointer}
      .nl-shelf-actions .save{background:#3b2a1d;color:#fff;border-color:#3b2a1d}
      .nl-shelf-status{margin-right:auto;align-self:center;color:#75695d;font-size:11px}
      .nl-book-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.nl-book-panel{width:100%;margin-top:8px}
      .nl-book-panel[hidden]{display:none}.nl-book-note{margin:8px 0 0;color:#75695d;font-size:11px;line-height:1.6}
      .nl-bookshelf-unavailable{margin-bottom:16px;padding:12px;border:1px solid #e0d7c7;border-radius:10px;background:#fffaf0;color:#776957;font-size:12px}
      @media(max-width:640px){
        .nl-bookshelf-toolbar,.nl-shelf-fields{grid-template-columns:1fr}
        .nl-shelf-fields textarea{grid-column:auto}
        .nl-shelf-actions{flex-direction:column}.nl-shelf-actions button{width:100%}
        .nl-shelf-status{margin-right:0}
      }
    `;
    document.head.appendChild(style);
  }

  function waitFor(selector, timeout = 10000) {
    const found = document.querySelector(selector);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const node = document.querySelector(selector);
        if (!node) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(node);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      const timer =
        timeout > 0
          ? setTimeout(() => {
              observer.disconnect();
              reject(new Error(`Timed out waiting for ${selector}`));
            }, timeout)
          : null;
    });
  }
  function stateOptions(selected, blank = true) {
    const parts = [];
    if (blank) {
      parts.push(
        `<option value=""${selected ? '' : ' selected'}>状態を選ぶ</option>`
      );
    }
    for (const [value, label] of Object.entries(STATES)) {
      parts.push(
        `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`
      );
    }
    return parts.join('');
  }

  function organizerMarkup(entry) {
    return `
      <div class="nl-shelf-fields">
        <select class="nl-shelf-state" aria-label="読書状態">${stateOptions(entry?.reading_state || '')}</select>
        <input class="nl-shelf-list-name" maxlength="60" placeholder="自分用リスト（例：休日に読む）" value="${escapeHtml(entry?.list_name || '')}">
        <textarea class="nl-shelf-memo" maxlength="1000" placeholder="自分だけに見えるメモ">${escapeHtml(entry?.memo || '')}</textarea>
      </div>
      <div class="nl-shelf-actions">
        <span class="nl-shelf-status">${entry ? '非公開で保存済み' : '未整理'}</span>
        <button class="remove" type="button"${entry ? '' : ' disabled'}>本棚整理を解除</button>
        <button class="save" type="button">保存</button>
      </div>
    `;
  }
  function workCard(novel, favorite, entry) {
    const article = document.createElement('article');
    article.className = 'nl-shelf-entry';
    article.dataset.novelId = String(novel.id);
    article.dataset.favorite = favorite ? 'true' : 'false';
    article.dataset.state = entry?.reading_state || 'unorganized';
    article.dataset.list = entry?.list_name || '';

    const link = document.createElement('a');
    link.className = 'card nl-shelf-card';
    link.href = `novel.html?id=${encodeURIComponent(novel.id)}`;
    link.innerHTML = `
      <span class="genre">${escapeHtml(novel.genre || '未設定')}</span>
      <div class="title">${escapeHtml(novel.title)}</div>
      <div class="desc">${escapeHtml(novel.description || '')}</div>
      <div class="meta">👁 ${Number(novel.pv || 0).toLocaleString()} PV</div>
      <div class="nl-shelf-badges"></div>
    `;

    const organizer = document.createElement('div');
    organizer.className = 'nl-shelf-organizer';
    organizer.innerHTML = organizerMarkup(entry);
    article.append(link, organizer);
    renderOrganizerState(article, entry);
    return article;
  }
  function renderOrganizerState(article, entry) {
    article.dataset.state = entry?.reading_state || 'unorganized';
    article.dataset.list = entry?.list_name || '';
    const status = article.querySelector('.nl-shelf-status');
    if (status) status.textContent = entry ? '非公開で保存済み' : '未整理';
    const remove = article.querySelector('.remove');
    if (remove) remove.disabled = !entry;

    const badges = article.querySelector('.nl-shelf-badges');
    if (!badges) return;
    const favorite = article.dataset.favorite === 'true';
    badges.innerHTML = `
      ${favorite ? '<span class="nl-shelf-badge favorite">★ お気に入り</span>' : ''}
      ${entry ? `<span class="nl-shelf-badge">${escapeHtml(STATES[entry.reading_state])}</span>` : '<span class="nl-shelf-badge">未整理</span>'}
      ${entry?.list_name ? `<span class="nl-shelf-badge">${escapeHtml(entry.list_name)}</span>` : ''}
    `;
  }

  function readOrganizer(article) {
    return {
      readingState: article.querySelector('.nl-shelf-state')?.value || '',
      listName: article.querySelector('.nl-shelf-list-name')?.value || '',
      memo: article.querySelector('.nl-shelf-memo')?.value || ''
    };
  }
  function refreshListFilter(list, select) {
    if (!select) return;
    const previous = select.value;
    const names = [
      ...new Set(
        [...list.querySelectorAll('.nl-shelf-entry')]
          .map((article) => article.dataset.list)
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b, 'ja'));
    select.replaceChildren(new Option('すべての自分用リスト', 'all'));
    for (const name of names) select.add(new Option(name, name));
    select.value = names.includes(previous) ? previous : 'all';
  }

  function applyFilters(list) {
    const state =
      document.getElementById('bookshelfStateFilter')?.value || 'all';
    const listName =
      document.getElementById('bookshelfListFilter')?.value || 'all';
    let visible = 0;
    for (const article of list.querySelectorAll('.nl-shelf-entry')) {
      const stateMatch =
        state === 'all' ||
        (state === 'favorites' && article.dataset.favorite === 'true') ||
        article.dataset.state === state;
      const listMatch = listName === 'all' || article.dataset.list === listName;
      article.hidden = !(stateMatch && listMatch);
      if (!article.hidden) visible += 1;
    }
    const summary = document.getElementById('bookshelfSummary');
    if (summary) summary.textContent = `${visible}作品を表示中`;
  }
  async function installBookshelfPage(clientInstance) {
    const list = document.getElementById('list');
    if (!list) return false;
    installStyles();
    const session = await currentSession(clientInstance);
    if (!session) {
      window.location.href = 'login.html?redirect=favorites.html';
      return false;
    }
    void window.NovelightClient?.recordVisit?.(clientInstance);
    void window.NovelightClient?.claimAcquisition?.(clientInstance);

    const [favoritesResult, shelf] = await Promise.all([
      clientInstance
        .from('favorites')
        .select('novel_id,created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false }),
      loadEntries(clientInstance, session.user.id)
    ]);
    if (favoritesResult.error) throw favoritesResult.error;

    const favorites = favoritesResult.data || [];
    const favoriteIds = new Set(favorites.map((row) => String(row.novel_id)));
    const entryMap = new Map(
      shelf.entries.map((entry) => [String(entry.novel_id), entry])
    );
    const ids = [
      ...new Set([
        ...favorites.map((row) => String(row.novel_id)),
        ...shelf.entries.map((row) => String(row.novel_id))
      ])
    ];

    if (!shelf.available) {
      const warning = document.getElementById('bookshelfUnavailable');
      if (warning) warning.hidden = false;
    }
    if (!ids.length) {
      list.innerHTML =
        '<div class="empty">本棚はまだ空です。作品ページから「本棚に追加」またはお気に入り登録すると、ここで管理できます。</div>';
      return true;
    }

    const novelsResult = await clientInstance
      .from('novels')
      .select('id,title,genre,description,pv,status')
      .in('id', ids)
      .eq('status', 'published');
    if (novelsResult.error) throw novelsResult.error;
    const novelMap = new Map(
      (novelsResult.data || []).map((novel) => [String(novel.id), novel])
    );
    const favoriteCreated = new Map(
      favorites.map((row) => [
        String(row.novel_id),
        new Date(row.created_at || 0).getTime()
      ])
    );
    ids.sort((left, right) => {
      const leftAt = Math.max(
        new Date(entryMap.get(left)?.updated_at || 0).getTime(),
        favoriteCreated.get(left) || 0
      );
      const rightAt = Math.max(
        new Date(entryMap.get(right)?.updated_at || 0).getTime(),
        favoriteCreated.get(right) || 0
      );
      return rightAt - leftAt;
    });

    list.replaceChildren();
    for (const id of ids) {
      const novel = novelMap.get(id);
      if (!novel) continue;
      list.appendChild(
        workCard(novel, favoriteIds.has(id), entryMap.get(id) || null)
      );
    }

    const stateFilter = document.getElementById('bookshelfStateFilter');
    const listFilter = document.getElementById('bookshelfListFilter');
    refreshListFilter(list, listFilter);
    stateFilter?.addEventListener('change', () => applyFilters(list));
    listFilter?.addEventListener('change', () => applyFilters(list));
    for (const article of list.querySelectorAll('.nl-shelf-entry')) {
      const novelId = article.dataset.novelId;
      if (!shelf.available) {
        article
          .querySelectorAll('input,textarea,select,button')
          .forEach((control) => {
            control.disabled = true;
          });
        continue;
      }

      const save = article.querySelector('.save');
      const remove = article.querySelector('.remove');
      save?.addEventListener('click', async () => {
        save.disabled = true;
        const status = article.querySelector('.nl-shelf-status');
        if (status) status.textContent = '保存中...';
        try {
          const entry = await saveEntry(
            clientInstance,
            session.user.id,
            novelId,
            readOrganizer(article)
          );
          entryMap.set(novelId, entry);
          renderOrganizerState(article, entry);
          refreshListFilter(list, listFilter);
          applyFilters(list);
        } catch (error) {
          console.error('bookshelf save failed', error);
          if (status)
            status.textContent = error?.message || '保存できませんでした';
        } finally {
          save.disabled = false;
        }
      });
      remove?.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await deleteEntry(clientInstance, session.user.id, novelId);
          entryMap.delete(novelId);
          if (article.dataset.favorite === 'true') {
            article.querySelector('.nl-shelf-state').value = '';
            article.querySelector('.nl-shelf-list-name').value = '';
            article.querySelector('.nl-shelf-memo').value = '';
            renderOrganizerState(article, null);
          } else {
            article.remove();
          }
          refreshListFilter(list, listFilter);
          applyFilters(list);
        } catch (error) {
          console.error('bookshelf delete failed', error);
          const status = article.querySelector('.nl-shelf-status');
          if (status) status.textContent = '解除できませんでした';
          remove.disabled = false;
        }
      });
    }

    applyFilters(list);
    return true;
  }
  async function installNovelControl(clientInstance) {
    const novelId = new URLSearchParams(window.location.search).get('id');
    if (!novelId) return false;
    const favoriteButton = await waitFor('#favoriteButton', 0).catch(
      () => null
    );
    if (!favoriteButton || document.getElementById('nlBookControl'))
      return false;
    installStyles();

    const session = await currentSession(clientInstance);
    const control = document.createElement('div');
    control.id = 'nlBookControl';
    control.className = 'nl-book-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nl-book-control-button';
    button.textContent = '📚 本棚に追加';
    const panel = document.createElement('div');
    panel.className = 'nl-book-panel';
    panel.hidden = true;
    panel.innerHTML = `
      ${organizerMarkup(null)}
      <p class="nl-book-note">本棚の状態・自分用リスト・メモは非公開です。作品Rank、LIGHT SEED、SCOUT、露出には加点されません。</p>
    `;
    control.append(button, panel);
    favoriteButton.insertAdjacentElement('afterend', control);
    if (!session) {
      button.addEventListener('click', () => {
        window.location.href =
          'login.html?redirect=' +
          encodeURIComponent(`novel.html?id=${novelId}`);
      });
      return true;
    }

    const loaded = await loadEntry(clientInstance, session.user.id, novelId);
    if (!loaded.available) {
      button.disabled = true;
      button.textContent = '📚 本棚は準備中';
      return true;
    }

    let entry = loaded.entry;
    if (entry) {
      button.textContent = `📚 ${STATES[entry.reading_state]}`;
      panel.innerHTML = `
        ${organizerMarkup(entry)}
        <p class="nl-book-note">本棚の状態・自分用リスト・メモは非公開です。作品Rank、LIGHT SEED、SCOUT、露出には加点されません。</p>
      `;
    } else {
      panel.querySelector('.nl-shelf-state').value = 'want_to_read';
    }

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
    const save = panel.querySelector('.save');
    const remove = panel.querySelector('.remove');
    const status = panel.querySelector('.nl-shelf-status');

    save?.addEventListener('click', async () => {
      save.disabled = true;
      if (status) status.textContent = '保存中...';
      try {
        entry = await saveEntry(clientInstance, session.user.id, novelId, {
          readingState: panel.querySelector('.nl-shelf-state')?.value || '',
          listName: panel.querySelector('.nl-shelf-list-name')?.value || '',
          memo: panel.querySelector('.nl-shelf-memo')?.value || ''
        });
        button.textContent = `📚 ${STATES[entry.reading_state]}`;
        if (status) status.textContent = '非公開で保存済み';
        if (remove) remove.disabled = false;
      } catch (error) {
        console.error('bookshelf save failed', error);
        if (status)
          status.textContent = error?.message || '保存できませんでした';
      } finally {
        save.disabled = false;
      }
    });
    remove?.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await deleteEntry(clientInstance, session.user.id, novelId);
        entry = null;
        button.textContent = '📚 本棚に追加';
        panel.querySelector('.nl-shelf-state').value = 'want_to_read';
        panel.querySelector('.nl-shelf-list-name').value = '';
        panel.querySelector('.nl-shelf-memo').value = '';
        if (status) status.textContent = '未整理';
      } catch (error) {
        console.error('bookshelf delete failed', error);
        if (status) status.textContent = '解除できませんでした';
      } finally {
        remove.disabled = !entry;
      }
    });
    return true;
  }

  window.NovelightBookshelf = Object.freeze({
    STATES,
    isMissingBookshelfTable,
    validatePayload,
    loadEntry,
    loadEntries,
    saveEntry,
    deleteEntry,
    installBookshelfPage,
    installNovelControl
  });
  if (typeof client !== 'undefined' && client) {
    const slug = pageSlug();
    if (slug === 'favorites') {
      void installBookshelfPage(client).catch((error) => {
        console.error('bookshelf page failed', error);
        const list = document.getElementById('list');
        if (list) {
          list.innerHTML =
            '<div class="empty">本棚を表示できませんでした。通信状況を確認して、もう一度お試しください。</div>';
        }
      });
    }
    if (slug === 'novel') {
      void installNovelControl(client).catch((error) => {
        console.error('novel bookshelf control failed', error);
      });
    }
  }
})();
