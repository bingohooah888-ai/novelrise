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
    @media(max-width:720px){.nl-toolbar-divider{display:none}}
    @media(max-width:470px){.nl-author-menu{width:100%}.nl-author-menu>summary{width:100%}.nl-author-popover{position:fixed;left:12px;right:12px;top:auto;bottom:14px;min-width:0}}
  `;
  document.head.appendChild(style);

  if (illustrationButton) illustrationButton.textContent = '挿絵';
  if (scheduleButton) scheduleButton.classList.add('nl-schedule-action');

  const status = document.getElementById('status');
  const menus = [];
  const ownerTools = [];
  const layoutSeparators = [];

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

  const characterButton = makeToolButton('人物', () => openAuthorPage('characters.html'), true);
  const notesButton = makeToolButton('ノート', () => openAuthorPage('story-notes.html'), true);
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
