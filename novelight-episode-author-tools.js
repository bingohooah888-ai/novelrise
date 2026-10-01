(() => {
  'use strict';

  const toolbar = document.querySelector('.editor-tools');
  const textarea = document.getElementById('content');
  const chapterButton = document.getElementById('openChapterSettings');
  const illustrationButton = document.getElementById('openIllustrationEditor');
  const scheduleButton = document.getElementById('openScheduleSettings');
  const primaryButton = document.getElementById('publish') || document.getElementById('save');
  if (!toolbar || !textarea || !chapterButton || !primaryButton) return;

  const isPost = document.body.classList.contains('novelight-page-episode-post');
  const isEdit = document.body.classList.contains('novelight-page-episode-edit');
  if (!isPost && !isEdit) return;

  const style = document.createElement('style');
  style.id = 'novelightEpisodeAuthorToolsStyle';
  style.textContent = `
    .nl-author-menu{position:relative}
    .nl-author-menu>summary{display:inline-flex;align-items:center;justify-content:center;list-style:none;user-select:none}
    .nl-author-menu>summary::-webkit-details-marker{display:none}
    .nl-author-popover{position:absolute;top:calc(100% + 7px);right:0;z-index:95;min-width:190px;padding:6px;border:1px solid #dedbe6;border-radius:10px;background:#fff;box-shadow:0 14px 34px rgba(24,20,31,.16)}
    .nl-author-popover button{display:block;width:100%;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:#403a48;text-align:left;font:inherit;font-size:13px;font-weight:800;cursor:pointer}
    .nl-author-popover button:hover:not(:disabled){background:#f5f2fb}
    .nl-author-popover button:disabled{opacity:.45;cursor:not-allowed}
    .nl-toolbar-divider{width:1px;height:26px;margin:0 3px;align-self:center;flex:0 0 auto;border-radius:999px;background:#dedbe6}
    #openScheduleSettings.nl-schedule-action{border-color:#dfd1b7;background:#fffaf0;color:#6c5531}
    #openScheduleSettings.nl-schedule-action:hover:not(:disabled){border-color:#cfbb96;background:#fff6e5}
    .nl-inline-notes{display:grid;gap:18px;color:#302b34}
    .nl-note-editor,.nl-note-card{border:1px solid #e3e0e8;border-radius:12px;background:#fff}
    .nl-note-editor{padding:15px}
    .nl-note-field{display:grid;gap:6px;margin-bottom:12px}
    .nl-note-field>span{font-size:12px;font-weight:900;color:#5e5765}
    .nl-note-field textarea{width:100%;min-height:170px;padding:11px 12px;border:1px solid #d6d8df;border-radius:9px;background:#fff;color:#2d2931;resize:vertical;line-height:1.65}
    .nl-note-field[hidden]{display:none}
    .nl-note-actions{display:flex;gap:8px}
    .nl-note-button{min-height:40px;padding:9px 12px;border:1px solid #cfc6e9;border-radius:9px;background:#faf8ff;color:#5840b4;font-weight:900;cursor:pointer}
    .nl-note-button.primary{border-color:#6d4aff;background:#6d4aff;color:#fff}
    .nl-note-button.danger{border-color:#e5c6c1;background:#fff8f7;color:#a44335}
    .nl-note-button:disabled{opacity:.5;cursor:not-allowed}
    .nl-note-status{min-height:20px;margin-top:10px;color:#736c63;font-size:12px;line-height:1.6}
    .nl-note-status.error{color:#b42318}
    .nl-note-list{display:grid;gap:10px}
    .nl-note-card{padding:13px}
    .nl-note-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
    .nl-note-card-title{margin:0;font-size:14px;line-height:1.5}
    .nl-note-tag{flex:none;padding:3px 7px;border-radius:999px;background:#f3eefc;color:#664fb7;font-size:10px;font-weight:900}
    .nl-note-character{margin-top:5px;color:#7a6e5b;font-size:11px;font-weight:800}
    .nl-note-body{margin-top:8px;color:#5f5964;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font-size:12px;max-height:150px;overflow:auto}
    .nl-note-meta{margin-top:8px;color:#96909a;font-size:10px}
    .nl-note-card-actions{display:flex;gap:7px;margin-top:10px}
    .nl-note-empty{padding:20px 10px;text-align:center;color:#8b8590;font-size:12px}
    @media(max-width:720px){.nl-toolbar-divider{display:none}.nl-note-actions,.nl-note-card-actions{flex-direction:column}.nl-note-button{width:100%}}
    @media(max-width:470px){.nl-author-menu{width:100%}.nl-author-menu>summary{width:100%}.nl-author-popover{position:fixed;left:12px;right:12px;top:auto;bottom:14px;min-width:0}}
  `;
  document.head.appendChild(style);

  if (illustrationButton) illustrationButton.textContent = '挿絵';
  if (scheduleButton) scheduleButton.classList.add('nl-schedule-action');

  const status = document.getElementById('status');
  const menus = [];
  const ownerTools = [];
  const layoutSeparators = [];
  let characterEditor = null;
  let notesPanel = null;

  function closeMenus(except = null) {
    menus.forEach(menu => { if (menu !== except) menu.open = false; });
  }

  function currentNovelId() {
    const direct = new URLSearchParams(location.search).get('novel_id');
    if (direct) return direct;
    const structure = document.getElementById('manageStructureLink');
    if (!structure?.href) return null;
    try { return new URL(structure.href, location.href).searchParams.get('novel_id'); }
    catch { return null; }
  }

  function showStatus(message) {
    if (status) status.textContent = message;
  }

  function openAuthorPage(path, key = 'novel_id') {
    const novelId = currentNovelId();
    if (!novelId) {
      showStatus('作品情報を読み込み中です。少し待ってからもう一度お試しください。');
      return;
    }
    const url = new URL(path, location.href);
    url.searchParams.set(key, novelId);
    window.open(url.href, '_blank', 'noopener');
  }

  function openInlineTool(title, node) {
    const drawer = document.getElementById('settingsDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    const drawerTitle = document.getElementById('drawerTitle');
    const drawerBody = drawer?.querySelector('.drawer-body');
    if (!drawer || !backdrop || !drawerTitle || !drawerBody || !node) return false;
    drawerBody.querySelectorAll('.drawer-pane').forEach(pane => { pane.hidden = true; });
    let pane = document.getElementById('novelightAuthorInlinePane');
    if (!pane) {
      pane = document.createElement('section');
      pane.id = 'novelightAuthorInlinePane';
      pane.className = 'drawer-pane';
      drawerBody.appendChild(pane);
    }
    pane.hidden = false;
    pane.replaceChildren(node);
    drawerTitle.textContent = title;
    backdrop.hidden = false;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    return true;
  }

  function hideInlinePane() {
    const pane = document.getElementById('novelightAuthorInlinePane');
    if (pane) pane.hidden = true;
  }

  function openCharacterTool() {
    if (isPost) {
      const integratedButton = document.getElementById('openCharacterSettings');
      if (integratedButton) {
        integratedButton.click();
        return;
      }
    }
    if (!isEdit || !currentNovelId()) {
      openAuthorPage('characters.html');
      return;
    }
    characterEditor ||= document.getElementById('characterEpisodeEditor');
    if (!characterEditor || !openInlineTool('人物', characterEditor)) {
      showStatus('登場人物を準備しています。少し待ってからもう一度お試しください。');
    }
  }

  function notesUnavailable(error) {
    const message = String(error?.message || '');
    return ['42883', 'PGRST202'].includes(String(error?.code || '')) ||
      message.includes('novelight_private_story_notes') ||
      message.includes('novelight_save_private_story_note') ||
      message.includes('does not exist') ||
      message.includes('Could not find the function');
  }

  function createNotesPanel() {
    const panel = document.createElement('div');
    panel.className = 'nl-inline-notes';
    panel.innerHTML = `
      <form class="nl-note-editor">
        <input class="nl-note-id" type="hidden">
        <label class="nl-note-field"><span>種類</span><select class="nl-note-type"><option value="plot">プロット</option><option value="world">世界観</option><option value="character">キャラクター</option></select></label>
        <label class="nl-note-field nl-note-character-field" hidden><span>登場人物</span><select class="nl-note-character"><option value="">登場人物を選択</option></select></label>
        <label class="nl-note-field"><span>タイトル</span><input class="nl-note-title" maxlength="120" required></label>
        <label class="nl-note-field"><span>メモ</span><textarea class="nl-note-body-input" maxlength="20000" placeholder="伏線、展開、設定、人物の背景など"></textarea></label>
        <div class="nl-note-actions"><button class="nl-note-button primary nl-note-save" type="submit" disabled>保存</button><button class="nl-note-button nl-note-cancel" type="button" hidden>編集をやめる</button></div>
        <div class="nl-note-status" aria-live="polite">読み込み待ち</div>
      </form>
      <div class="nl-note-list"><div class="nl-note-empty">読み込み中...</div></div>
    `;

    const form = panel.querySelector('form');
    const noteId = panel.querySelector('.nl-note-id');
    const type = panel.querySelector('.nl-note-type');
    const characterField = panel.querySelector('.nl-note-character-field');
    const character = panel.querySelector('.nl-note-character');
    const title = panel.querySelector('.nl-note-title');
    const body = panel.querySelector('.nl-note-body-input');
    const save = panel.querySelector('.nl-note-save');
    const cancel = panel.querySelector('.nl-note-cancel');
    const statusEl = panel.querySelector('.nl-note-status');
    const list = panel.querySelector('.nl-note-list');
    const typeLabels = { plot: 'プロット', world: '世界観', character: 'キャラクター' };
    let novelId = null;
    let notes = [];
    let characters = [];
    let ready = false;
    let busy = false;

    function setStatus(message, error = false) {
      statusEl.textContent = message;
      statusEl.classList.toggle('error', error);
    }

    function setBusy(value) {
      busy = value;
      save.disabled = value || !ready;
      cancel.disabled = value;
    }

    function syncCharacterField() {
      characterField.hidden = type.value !== 'character';
    }

    function resetForm() {
      form.reset();
      noteId.value = '';
      save.textContent = '保存';
      cancel.hidden = true;
      syncCharacterField();
    }

    function formatDate(value) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP') : '日時不明';
    }

    function renderCharacterOptions() {
      character.replaceChildren(new Option('登場人物を選択', ''));
      characters.forEach(item => character.appendChild(new Option(item.name, String(item.id))));
    }

    function editNote(note) {
      noteId.value = String(note.id);
      type.value = note.note_type;
      character.value = note.character_id == null ? '' : String(note.character_id);
      title.value = note.title || '';
      body.value = note.body || '';
      save.textContent = '変更を保存';
      cancel.hidden = false;
      syncCharacterField();
      panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    async function deleteNote(id) {
      if (!ready || busy || !confirm('この非公開創作ノートを削除しますか？')) return;
      setBusy(true);
      setStatus('削除しています...');
      try {
        const result = await client.rpc('novelight_delete_private_story_note', { p_note_id: Number(id) });
        if (result.error) throw result.error;
        if (String(noteId.value) === String(id)) resetForm();
        await loadData(false);
        setStatus('削除しました。');
      } catch (error) {
        console.error(error);
        setStatus(notesUnavailable(error) ? '創作ノートはデータベース反映待ちです。' : '削除できませんでした。', true);
      } finally {
        setBusy(false);
      }
    }

    function renderNotes() {
      list.replaceChildren();
      if (!notes.length) {
        const empty = document.createElement('div');
        empty.className = 'nl-note-empty';
        empty.textContent = '創作ノートはまだありません。';
        list.appendChild(empty);
        return;
      }
      notes.forEach(note => {
        const card = document.createElement('article');
        card.className = 'nl-note-card';
        const head = document.createElement('div');
        head.className = 'nl-note-card-head';
        const heading = document.createElement('h3');
        heading.className = 'nl-note-card-title';
        heading.textContent = note.title || '無題';
        const tag = document.createElement('span');
        tag.className = 'nl-note-tag';
        tag.textContent = typeLabels[note.note_type] || note.note_type;
        head.append(heading, tag);
        card.appendChild(head);
        if (note.note_type === 'character') {
          const characterName = document.createElement('div');
          characterName.className = 'nl-note-character';
          characterName.textContent = note.character_name ? `人物：${note.character_name}` : '人物：登録解除済み';
          card.appendChild(characterName);
        }
        const noteBody = document.createElement('div');
        noteBody.className = 'nl-note-body';
        noteBody.textContent = note.body || '（本文なし）';
        const meta = document.createElement('div');
        meta.className = 'nl-note-meta';
        meta.textContent = `更新 ${formatDate(note.updated_at)}`;
        const actions = document.createElement('div');
        actions.className = 'nl-note-card-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'nl-note-button';
        edit.textContent = '編集';
        edit.addEventListener('click', () => editNote(note));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'nl-note-button danger';
        remove.textContent = '削除';
        remove.addEventListener('click', () => deleteNote(note.id));
        actions.append(edit, remove);
        card.append(noteBody, meta, actions);
        list.appendChild(card);
      });
    }

    async function loadData(showLoading = true) {
      const value = Number(currentNovelId());
      if (!Number.isInteger(value) || value <= 0) {
        ready = false;
        setBusy(false);
        setStatus('作品情報を読み込み中です。少し待ってからもう一度お試しください。', true);
        return;
      }
      novelId = value;
      ready = false;
      setBusy(true);
      if (showLoading) setStatus('創作ノートを読み込んでいます...');
      try {
        const [characterResult, noteResult] = await Promise.all([
          client.rpc('novelight_author_character_list', { p_novel_id: novelId }),
          client.rpc('novelight_private_story_notes', { p_novel_id: novelId })
        ]);
        if (characterResult.error) throw characterResult.error;
        if (noteResult.error) throw noteResult.error;
        characters = Array.isArray(characterResult.data) ? characterResult.data : [];
        notes = Array.isArray(noteResult.data) ? noteResult.data : [];
        renderCharacterOptions();
        renderNotes();
        ready = true;
        setStatus('作者本人だけに表示される非公開ノートです。');
      } catch (error) {
        console.error(error);
        notes = [];
        renderNotes();
        setStatus(notesUnavailable(error) ? '創作ノートはデータベース反映待ちです。' : '創作ノートを読み込めませんでした。', true);
      } finally {
        setBusy(false);
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ready || busy || !novelId) return;
      const noteType = type.value;
      const titleValue = title.value.trim();
      const characterValue = character.value;
      if (!titleValue) {
        setStatus('タイトルを入力してください。', true);
        return;
      }
      if (noteType === 'character' && !characterValue) {
        setStatus('キャラクターノートは登場人物を選択してください。', true);
        return;
      }
      setBusy(true);
      setStatus('保存しています...');
      try {
        const result = await client.rpc('novelight_save_private_story_note', {
          p_novel_id: novelId,
          p_note_id: noteId.value ? Number(noteId.value) : null,
          p_note_type: noteType,
          p_character_id: noteType === 'character' ? Number(characterValue) : null,
          p_title: titleValue,
          p_body: body.value
        });
        if (result.error) throw result.error;
        resetForm();
        await loadData(false);
        setStatus('非公開の創作ノートとして保存しました。');
      } catch (error) {
        console.error(error);
        setStatus(notesUnavailable(error) ? '創作ノートはデータベース反映待ちです。' : '保存できませんでした。', true);
      } finally {
        setBusy(false);
      }
    });

    cancel.addEventListener('click', () => {
      resetForm();
      setStatus('編集を取り消しました。');
    });
    type.addEventListener('change', syncCharacterField);
    panel.__novelightLoadNotes = () => loadData(true);
    syncCharacterField();
    return panel;
  }

  function openNotesTool() {
    const novelId = currentNovelId();
    if (!novelId) {
      showStatus('作品情報を読み込み中です。少し待ってからもう一度お試しください。');
      return;
    }
    notesPanel ||= createNotesPanel();
    if (!openInlineTool('ノート', notesPanel)) {
      openAuthorPage('story-notes.html');
      return;
    }
    notesPanel.__novelightLoadNotes?.();
  }

  [chapterButton, illustrationButton, scheduleButton].filter(Boolean).forEach(button => {
    button.addEventListener('click', hideInlinePane, true);
  });

  function makeToolButton(label, onClick, ownerOnly = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool-button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    if (ownerOnly) ownerTools.push(button);
    return button;
  }

  function makeMenu(label, items, ownerOnly = false) {
    const details = document.createElement('details');
    details.className = 'nl-author-menu';
    const summary = document.createElement('summary');
    summary.className = 'tool-button';
    summary.textContent = label;
    const panel = document.createElement('div');
    panel.className = 'nl-author-popover';
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      if (item.title) button.title = item.title;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        details.open = false;
        item.run();
      });
      panel.appendChild(button);
    });
    details.append(summary, panel);
    details.addEventListener('toggle', () => { if (details.open) closeMenus(details); });
    menus.push(details);
    if (ownerOnly) ownerTools.push(details);
    return details;
  }

  function insertDivider(beforeNode) {
    if (!beforeNode) return;
    const divider = document.createElement('span');
    divider.className = 'nl-toolbar-divider';
    divider.setAttribute('aria-hidden', 'true');
    toolbar.insertBefore(divider, beforeNode);
    layoutSeparators.push(divider);
  }

  function selectedText() {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    return { start, end, text: textarea.value.slice(start, end) };
  }

  function replaceSelection(replacement, start, end) {
    textarea.setRangeText(replacement, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function addRuby() {
    const selection = selectedText();
    if (!selection.text) {
      alert('ルビを振る本文を選択してください。');
      return;
    }
    if (selection.text.length > 50 || /[\r\n《》｜]/u.test(selection.text)) {
      alert('ルビを振る本文は1行・50文字以内で選択してください。');
      return;
    }
    const reading = prompt('ルビを入力してください。', '');
    if (reading === null) return;
    const value = reading.trim();
    if (!value || value.length > 30 || /[\r\n《》｜]/u.test(value)) {
      alert('ルビは1行・30文字以内で入力してください。');
      return;
    }
    replaceSelection(`｜${selection.text}《${value}》`, selection.start, selection.end);
  }

  function addEmphasis() {
    const selection = selectedText();
    if (!selection.text) {
      alert('傍点を付ける本文を選択してください。');
      return;
    }
    if (selection.text.length > 80 || /[\r\n]/u.test(selection.text)) {
      alert('傍点を付ける本文は1行・80文字以内で選択してください。');
      return;
    }
    replaceSelection(`《《${selection.text}》》`, selection.start, selection.end);
  }

  const characterButton = makeToolButton('人物', openCharacterTool, true);
  const notesButton = makeToolButton('ノート', openNotesTool, true);
  const decorateMenu = makeMenu('装飾', [
    { label: 'ルビ', run: addRuby },
    { label: '傍点', run: addEmphasis }
  ]);
  const moreMenu = makeMenu('その他', [
    {
      label: '改稿履歴',
      disabled: !isEdit,
      title: isEdit ? '' : 'エピソード保存後に利用できます。',
      run: () => document.getElementById('historyHost')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    { label: '下書き一覧', run: () => openAuthorPage('episode-drafts.html') },
    { label: '限定共有', run: () => openAuthorPage('share-link.html') },
    { label: '共同執筆', run: () => openAuthorPage('collaboration.html') },
    { label: '作品設定', run: () => openAuthorPage('novel-edit.html', 'id') }
  ], true);

  toolbar.insertBefore(characterButton, chapterButton);
  toolbar.insertBefore(notesButton, chapterButton);
  toolbar.insertBefore(decorateMenu, chapterButton);
  insertDivider(chapterButton);
  toolbar.insertBefore(moreMenu, scheduleButton || primaryButton);
  insertDivider(scheduleButton || primaryButton);

  function syncCollaborationMode() {
    const collaborative = document.body.dataset.collaborationEditor === 'true';
    ownerTools.forEach(tool => { tool.hidden = collaborative; });
    layoutSeparators.forEach(divider => { divider.hidden = collaborative; });
    if (collaborative) hideInlinePane();
  }
  syncCollaborationMode();
  new MutationObserver(syncCollaborationMode).observe(document.body, { attributes: true, attributeFilter: ['data-collaboration-editor'] });

  document.addEventListener('click', event => {
    if (!menus.some(menu => menu.contains(event.target))) closeMenus();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(); });

  if (isEdit && !document.querySelector('script[data-novelight-episode-visual-editor]')) {
    const visualEditor = document.createElement('script');
    visualEditor.src = 'novelight-episode-visual-editor.js';
    visualEditor.dataset.novelightEpisodeVisualEditor = 'true';
    document.body.appendChild(visualEditor);
  }
})();