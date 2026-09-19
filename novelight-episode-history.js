(function () {
  'use strict';

  const STYLE_ID = 'novelight-episode-history-style';
  const PANEL_ID = 'episodeHistoryPanel';

  function currentEpisodeId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  function fieldValue(id) {
    return document.getElementById(id)?.value ?? '';
  }

  function waitUntilEpisodeReady(timeout = 10000) {
    const started = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const number = document.getElementById('episodeNumber');
        const title = document.getElementById('title');
        const content = document.getElementById('content');
        if (number && title && content && number.value && typeof client !== 'undefined') {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeout) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-history-panel{margin-top:22px;padding:20px;border:1px solid #ddd3c3;border-radius:12px;background:#fffdf8;color:#453a2c}
      .nl-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.nl-history-title{margin:0;font-size:18px}.nl-history-copy{margin:6px 0 0;color:#756958;font-size:12px;line-height:1.7}
      .nl-history-list{display:grid;gap:9px;margin-top:16px}.nl-history-empty{padding:14px;border-radius:9px;background:#f7f2e9;color:#756958;font-size:12px;line-height:1.7}
      .nl-history-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 13px;border:1px solid #e6ded2;border-radius:9px;background:#fff}.nl-history-meta{font-size:11px;color:#827462;line-height:1.6}.nl-history-name{margin-top:2px;font-size:13px;font-weight:900;word-break:break-word}
      .nl-history-button{min-height:38px;padding:8px 12px;border:1px solid #6a5438;border-radius:8px;background:#fff;color:#59452f;font:inherit;font-size:12px;font-weight:900;cursor:pointer}.nl-history-button.primary{background:#4b3928;color:#fff}.nl-history-button:disabled{opacity:.55;cursor:not-allowed}
      .nl-history-modal{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(18,14,10,.72)}.nl-history-card{width:min(860px,100%);max-height:90vh;overflow:auto;border-radius:16px;background:#fffdf8;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.24)}
      .nl-history-modal-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;margin-top:20px}.nl-history-preview-title{margin:8px 0 18px;font-size:25px;line-height:1.5}.nl-history-preview-content{white-space:pre-wrap;word-break:break-word;font-size:16px;line-height:2}.nl-history-warning{margin:0 0 16px;padding:10px 12px;border:1px solid #e4c88b;border-radius:8px;background:#fff7e4;color:#6a5128;font-size:12px;line-height:1.7}
      @media(max-width:640px){.nl-history-row{grid-template-columns:1fr}.nl-history-button{width:100%}.nl-history-card{padding:22px 18px}.nl-history-preview-title{font-size:22px}}
    `;
    document.head.appendChild(style);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '日時不明';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function kindLabel(kind) {
    if (kind === 'restore') return '復元前';
    if (kind === 'typo_apply') return '誤字修正前';
    return '編集前';
  }

  function setPageStatus(message) {
    const node = document.getElementById('status');
    if (node) node.textContent = message;
  }

  async function hasUnsavedFormChanges(episodeId) {
    const response = await client
      .from('episodes')
      .select('episode_number,title,content')
      .eq('id', episodeId)
      .single();
    if (response.error || !response.data) throw response.error || new Error('episode unavailable');
    return (
      Number(fieldValue('episodeNumber')) !== Number(response.data.episode_number) ||
      fieldValue('title') !== String(response.data.title || '') ||
      fieldValue('content') !== String(response.data.content || '')
    );
  }

  function buildModal(revision, episodeId, refresh) {
    const modal = document.createElement('div');
    modal.className = 'nl-history-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const card = document.createElement('article');
    card.className = 'nl-history-card';
    const warning = document.createElement('p');
    warning.className = 'nl-history-warning';
    warning.textContent = '復元するのはタイトルと本文だけです。話数・公開状態・予約公開・PV・Rank・LIGHT SEED・SCOUTなどの評価データは変更しません。';
    const meta = document.createElement('div');
    meta.className = 'nl-history-meta';
    meta.textContent = `${formatDate(revision.created_at)} ・ ${kindLabel(revision.change_kind)} ・ 当時の第${revision.episode_number}話`;
    const title = document.createElement('h2');
    title.className = 'nl-history-preview-title';
    title.textContent = revision.title || '（タイトルなし）';
    const content = document.createElement('div');
    content.className = 'nl-history-preview-content';
    content.textContent = revision.content || '（本文なし）';
    const actions = document.createElement('div');
    actions.className = 'nl-history-modal-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nl-history-button';
    close.textContent = '閉じる';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'nl-history-button primary';
    restore.textContent = 'この版を復元';

    const dismiss = () => modal.remove();
    close.addEventListener('click', dismiss);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) dismiss();
    });

    restore.addEventListener('click', async () => {
      restore.disabled = true;
      try {
        if (await hasUnsavedFormChanges(episodeId)) {
          setPageStatus('未保存の変更があります。先に保存してから履歴を復元してください。');
          return;
        }
        if (!window.confirm('この版のタイトルと本文を復元しますか？現在の保存済み内容も履歴に残るため、あとから戻せます。')) return;
        const result = await client.rpc('novelight_restore_episode_revision', {
          p_episode_id: episodeId,
          p_revision_id: revision.revision_id
        });
        if (result.error) throw result.error;
        const restored = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!restored) throw new Error('restore returned no episode');
        const titleField = document.getElementById('title');
        const contentField = document.getElementById('content');
        if (titleField) titleField.value = restored.title || '';
        if (contentField) contentField.value = restored.content || '';
        window.NovelightAuthorDraft?.clearCurrentDraft?.();
        titleField?.dispatchEvent(new Event('input', { bubbles: true }));
        contentField?.dispatchEvent(new Event('input', { bubbles: true }));
        dismiss();
        setPageStatus('過去版のタイトルと本文を復元しました。公開状態や評価データは変更していません。');
        await refresh();
      } catch (error) {
        console.error(error);
        setPageStatus('履歴を復元できませんでした。再読み込みしてお試しください。');
      } finally {
        restore.disabled = false;
      }
    });

    actions.append(close, restore);
    card.append(warning, meta, title, content, actions);
    modal.appendChild(card);
    document.body.appendChild(modal);
    window.NovelightProse?.enhance(modal);
  }

  async function install() {
    if (document.body.dataset.collaborationEditor === 'true') return false;
    if (!/episode-edit(?:\.html)?$/u.test(window.location.pathname)) return false;
    const episodeId = currentEpisodeId();
    if (!episodeId || !(await waitUntilEpisodeReady())) return false;
    const formCard = document.querySelector('main .card');
    if (!formCard || document.getElementById(PANEL_ID)) return false;

    installStyles();
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'nl-history-panel';
    const head = document.createElement('div');
    head.className = 'nl-history-head';
    const headingWrap = document.createElement('div');
    const heading = document.createElement('h2');
    heading.className = 'nl-history-title';
    heading.textContent = '改稿履歴';
    const copy = document.createElement('p');
    copy.className = 'nl-history-copy';
    copy.textContent = '保存前のタイトル・本文を最大20版／90日まで保持します。履歴は作者本人だけが確認できます。';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'nl-history-button';
    reload.textContent = '履歴を更新';
    const list = document.createElement('div');
    list.className = 'nl-history-list';
    headingWrap.append(heading, copy);
    head.append(headingWrap, reload);
    panel.append(head, list);
    formCard.appendChild(panel);

    const refresh = async () => {
      reload.disabled = true;
      list.replaceChildren();
      try {
        const result = await client.rpc('novelight_list_episode_revisions', {
          p_episode_id: episodeId
        });
        if (result.error) throw result.error;
        const rows = Array.isArray(result.data) ? result.data : [];
        if (!rows.length) {
          const empty = document.createElement('div');
          empty.className = 'nl-history-empty';
          empty.textContent = 'まだ改稿履歴はありません。次回、タイトルまたは本文を保存すると更新前の版がここに残ります。';
          list.appendChild(empty);
          return;
        }
        for (const row of rows) {
          const item = document.createElement('article');
          item.className = 'nl-history-row';
          const info = document.createElement('div');
          const meta = document.createElement('div');
          meta.className = 'nl-history-meta';
          meta.textContent = `${formatDate(row.created_at)} ・ ${kindLabel(row.change_kind)} ・ ${Number(row.content_chars || 0).toLocaleString('ja-JP')}文字`;
          const name = document.createElement('div');
          name.className = 'nl-history-name';
          name.textContent = row.title || '（タイトルなし）';
          const view = document.createElement('button');
          view.type = 'button';
          view.className = 'nl-history-button';
          view.textContent = '内容を見る';
          view.addEventListener('click', async () => {
            view.disabled = true;
            try {
              const detail = await client.rpc('novelight_get_episode_revision', {
                p_revision_id: row.revision_id
              });
              if (detail.error) throw detail.error;
              const revision = Array.isArray(detail.data) ? detail.data[0] : detail.data;
              if (!revision) throw new Error('revision unavailable');
              buildModal(revision, episodeId, refresh);
            } catch (error) {
              console.error(error);
              setPageStatus('履歴を読み込めませんでした。再度お試しください。');
            } finally {
              view.disabled = false;
            }
          });
          info.append(meta, name);
          item.append(info, view);
          list.appendChild(item);
        }
      } catch (error) {
        console.error(error);
        const failure = document.createElement('div');
        failure.className = 'nl-history-empty';
        failure.textContent = '改稿履歴を読み込めませんでした。編集・保存機能はそのまま利用できます。';
        list.appendChild(failure);
      } finally {
        reload.disabled = false;
      }
    };

    reload.addEventListener('click', refresh);
    await refresh();
    return true;
  }

  window.NovelightEpisodeHistory = Object.freeze({ install });
  void install();
})();
