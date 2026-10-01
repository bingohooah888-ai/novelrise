(function () {
  'use strict';

  const RPC = Object.freeze({
    manage: 'novelight_manage_my_curation_lists',
    create: 'novelight_create_my_curation_list',
    update: 'novelight_update_my_curation_list',
    add: 'novelight_add_my_curation_item',
    remove: 'novelight_remove_my_curation_item',
    rotate: 'novelight_rotate_my_curation_share_token',
    delete: 'novelight_delete_my_curation_list',
    publicList: 'novelight_public_reader_curation'
  });

  function isUnavailableError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return (
      code === '42883' ||
      code === 'PGRST202' ||
      code === 'PGRST204' ||
      /function .* does not exist/iu.test(message)
    );
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }
  async function call(client, name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw result.error;
    return result.data;
  }

  function applyStaticDisplayNames() {
    if (document.body.classList.contains('novelight-page-curation-lists')) {
      document.title = 'おすすめリスト | NOVELIGHT';
      const heading = document.querySelector('.novelight-curation-hero h1');
      if (heading) heading.textContent = 'おすすめリスト';
    }
    if (document.body.classList.contains('novelight-page-curation')) {
      document.title = 'おすすめリスト | NOVELIGHT';
      const heading = document.getElementById('title');
      if (heading) heading.textContent = 'おすすめリスト';
    }
  }

  function applyPublicDisplayName(list) {
    if (!document.body.classList.contains('novelight-page-curation') || !list) return;
    const curator = cleanText(list.curator_display_name) || '名前未設定';
    const label = `${curator}さんのおすすめリスト`;
    const heading = document.getElementById('title');
    const meta = document.getElementById('meta');
    if (heading) heading.textContent = label;
    document.title = `${label} | NOVELIGHT`;
    if (meta) {
      const updated = new Date(list.updated_at);
      const date = Number.isFinite(updated.getTime()) ? updated.toLocaleDateString('ja-JP') : '日時不明';
      meta.textContent = `リスト：${cleanText(list.title) || '名称未設定'} ・ 更新 ${date}`;
    }
  }

  async function loadMyLists(client) {
    try {
      const data = await call(client, RPC.manage);
      return { available: true, lists: Array.isArray(data) ? data : [] };
    } catch (error) {
      if (isUnavailableError(error)) {
        return { available: false, lists: [] };
      }
      throw error;
    }
  }

  async function createList(client, values) {
    const title = cleanText(values?.title);
    const description = String(values?.description ?? '');
    if (!title || title.length > 80) {
      throw new Error('リスト名は1〜80文字で入力してください。');
    }
    if (description.length > 500) {
      throw new Error('説明は500文字以内で入力してください。');
    }
    return call(client, RPC.create, {
      p_title: title,
      p_description: description
    });
  }
  async function updateList(client, listId, values) {
    const title = cleanText(values?.title);
    const description = String(values?.description ?? '');
    const visibility = String(values?.visibility ?? '');
    if (!title || title.length > 80) {
      throw new Error('リスト名は1〜80文字で入力してください。');
    }
    if (description.length > 500) {
      throw new Error('説明は500文字以内で入力してください。');
    }
    if (!['private', 'shared'].includes(visibility)) {
      throw new Error('公開状態を選択してください。');
    }
    return call(client, RPC.update, {
      p_list_id: Number(listId),
      p_title: title,
      p_description: description,
      p_visibility: visibility
    });
  }

  function addItem(client, listId, novelId) {
    return call(client, RPC.add, {
      p_list_id: Number(listId),
      p_novel_id: Number(novelId)
    });
  }

  function removeItem(client, listId, novelId) {
    return call(client, RPC.remove, {
      p_list_id: Number(listId),
      p_novel_id: Number(novelId)
    });
  }
  function rotateShareToken(client, listId) {
    return call(client, RPC.rotate, { p_list_id: Number(listId) });
  }

  function deleteList(client, listId) {
    return call(client, RPC.delete, { p_list_id: Number(listId) });
  }

  async function loadPublicList(client, shareToken) {
    const token = String(shareToken || '');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        token
      )
    ) {
      return { available: true, list: null };
    }
    try {
      const list = await call(client, RPC.publicList, {
        p_share_token: token
      });
      if (list) requestAnimationFrame(() => applyPublicDisplayName(list));
      return {
        available: true,
        list
      };
    } catch (error) {
      if (isUnavailableError(error)) {
        return { available: false, list: null };
      }
      throw error;
    }
  }

  function shareUrl(token) {
    const url = new URL('curation.html', window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', String(token || ''));
    return url.href;
  }

  function button(label, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    return node;
  }
  function statusNode(text = '') {
    const node = document.createElement('span');
    node.className = 'novelight-curation-add-status';
    node.textContent = text;
    return node;
  }

  async function mountNovelControl(client, novel, session) {
    const favoriteButton = document.getElementById('favoriteButton');
    if (!favoriteButton || document.getElementById('curationAddButton')) return;

    const trigger = button('＋ おすすめリストに追加', 'novelight-curation-add-button');
    trigger.id = 'curationAddButton';
    favoriteButton.insertAdjacentElement('afterend', trigger);

    const panel = document.createElement('div');
    panel.id = 'curationAddPanel';
    panel.className = 'novelight-curation-add-panel';
    panel.hidden = true;

    const select = document.createElement('select');
    select.setAttribute('aria-label', '追加先おすすめリスト');
    const add = button('このリストに追加', 'novelight-curation-add-confirm');
    const manage = document.createElement('a');
    manage.href = 'curation-lists.html';
    manage.className = 'novelight-curation-manage-link';
    manage.textContent = 'おすすめリスト';
    const status = statusNode();

    panel.append(select, add, manage, status);
    trigger.insertAdjacentElement('afterend', panel);
    async function refresh() {
      status.textContent = 'リストを確認中...';
      add.disabled = true;
      const loaded = await loadMyLists(client);
      select.replaceChildren();

      if (!loaded.available) {
        status.textContent = 'おすすめリスト機能はデータベース反映待ちです。';
        trigger.disabled = true;
        return;
      }
      if (!loaded.lists.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '先にリストを作成してください';
        select.append(option);
        status.textContent = '管理画面から最初のリストを作成できます。';
        return;
      }
      for (const list of loaded.lists) {
        const option = document.createElement('option');
        option.value = String(list.list_id);
        option.textContent = String(list.title || '名称未設定');
        select.append(option);
      }
      add.disabled = false;
      status.textContent = '';
    }

    trigger.addEventListener('click', async () => {
      if (!session) {
        const redirect =
          'login.html?redirect=' +
          encodeURIComponent(
            window.location.pathname.split('/').pop() + window.location.search
          );
        window.location.href = redirect;
        return;
      }
      panel.hidden = !panel.hidden;
      if (!panel.hidden && select.options.length === 0) {
        try {
          await refresh();
        } catch (error) {
          console.error(error);
          status.textContent =
            'おすすめリストを読み込めませんでした。時間をおいて再度お試しください。';
        }
      }
    });

    add.addEventListener('click', async () => {
      if (!select.value) return;
      add.disabled = true;
      status.textContent = '追加中...';
      try {
        await addItem(client, select.value, novel.id);
        status.textContent = 'おすすめリストへ追加しました。';
      } catch (error) {
        console.error(error);
        status.textContent = /already/iu.test(String(error?.message || ''))
          ? 'この作品はすでにリストへ入っています。'
          : '追加できませんでした。';
      } finally {
        add.disabled = false;
      }
    });
  }

  function loadNovelDetailRuntime() {
    if (!/(^|\/)novel\.html$/u.test(window.location.pathname)) return;
    if (document.getElementById('novelight-novel-detail-v2')) return;
    const script = document.createElement('script');
    script.id = 'novelight-novel-detail-v2';
    script.src = 'novelight-novel-detail.js';
    document.body.appendChild(script);
  }

  applyStaticDisplayNames();
  window.addEventListener('load', loadNovelDetailRuntime, { once: true });

  window.NovelightCuration = Object.freeze({
    isUnavailableError,
    loadMyLists,
    createList,
    updateList,
    addItem,
    removeItem,
    rotateShareToken,
    deleteList,
    loadPublicList,
    shareUrl,
    mountNovelControl
  });
})();
