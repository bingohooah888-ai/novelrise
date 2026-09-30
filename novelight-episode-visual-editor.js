(() => {
  'use strict';

  if (!document.body.classList.contains('novelight-page-episode-edit')) return;

  const MARKER_RE = /^[\t ]*\[\[NOVELIGHT_ILLUSTRATION:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\][\t ]*$/iu;
  const textarea = document.getElementById('content');
  const form = document.getElementById('form');
  const titleInput = document.getElementById('title');
  const chapterSelect = document.getElementById('chapterId');
  const saveButton = document.getElementById('save');
  if (!textarea || !form || !titleInput || !saveButton) return;

  let editor = null;
  let assets = new Map();
  let active = false;
  let syncing = false;
  let refreshing = false;
  let refreshTimer = null;
  let initialSnapshot = null;

  const normalize = (value) => String(value ?? '').replace(/\r\n?/gu, '\n');
  const hasMarker = (value) => normalize(value).split('\n').some(line => MARKER_RE.test(line));

  function apiClient() {
    try {
      return typeof client !== 'undefined' ? client : null;
    } catch {
      return null;
    }
  }

  async function loadAssets() {
    const instance = apiClient();
    const episodeId = Number(new URLSearchParams(location.search).get('id'));
    if (!instance || !Number.isFinite(episodeId)) throw new Error('editor unavailable');
    const auth = await instance.auth.getSession();
    const session = auth?.data?.session;
    if (!session?.access_token) throw new Error('session unavailable');
    const response = await fetch('/api/episode-illustrations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ action: 'editor-list', episodeId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'illustration list unavailable');
    assets = new Map((data.assets || []).map(asset => [String(asset.id || '').toLowerCase(), asset]));
    return data;
  }

  function installStyle() {
    if (document.getElementById('novelightEpisodeVisualEditorStyle')) return;
    const style = document.createElement('style');
    style.id = 'novelightEpisodeVisualEditorStyle';
    style.textContent = `
      #content.nl-visual-source{position:absolute!important;left:-100000px!important;top:auto!important;width:1px!important;height:1px!important;min-height:1px!important;opacity:0!important;pointer-events:none!important;resize:none!important}
      .nl-visual-body-editor{width:100%;height:68vh;min-height:560px;padding:22px 4px;border:0;background:transparent;outline:none;overflow:auto;white-space:normal;word-break:break-word;line-height:2;font-size:17px;color:#26231f;caret-color:#26231f}
      .nl-visual-body-editor:empty:before{content:'本文を入力';color:#aaa49b;pointer-events:none}
      .nl-visual-line{min-height:2em;white-space:pre-wrap}
      .nl-visual-illustration{position:relative;margin:22px 0;padding:12px;border:1px solid #e3daca;border-radius:10px;background:#fffaf4;text-align:center;user-select:none}
      .nl-visual-illustration img{display:block;max-width:100%;max-height:520px;width:auto;height:auto;margin:0 auto;border-radius:6px;object-fit:contain}
      .nl-visual-illustration-tools{display:flex;justify-content:flex-end;margin-top:8px}
      .nl-visual-illustration-remove{min-height:34px;padding:6px 10px;border:1px solid #d4c6b5;border-radius:7px;background:#fff;color:#6a5137;font:inherit;font-size:11px;font-weight:800;cursor:pointer;pointer-events:auto}
      .nl-visual-illustration-missing{padding:24px 12px;color:#756b60;font-size:12px}
      @media(max-width:720px){.nl-visual-body-editor{height:64vh;min-height:480px;padding-top:16px;font-size:16px}.nl-visual-illustration{margin:18px 0;padding:9px}}
    `;
    document.head.appendChild(style);
  }

  function lineNode(text) {
    const node = document.createElement('div');
    node.className = 'nl-visual-line';
    if (text) node.textContent = text;
    else node.appendChild(document.createElement('br'));
    return node;
  }

  function illustrationNode(marker, id) {
    const figure = document.createElement('figure');
    figure.className = 'nl-visual-illustration';
    figure.contentEditable = 'false';
    figure.dataset.marker = marker;
    figure.dataset.illustrationId = id;
    const asset = assets.get(id.toLowerCase());
    if (asset?.url) {
      const image = document.createElement('img');
      image.src = asset.url;
      image.alt = asset.altText || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      if (asset.width) image.width = Number(asset.width);
      if (asset.height) image.height = Number(asset.height);
      figure.appendChild(image);
    } else {
      const missing = document.createElement('div');
      missing.className = 'nl-visual-illustration-missing';
      missing.textContent = '挿絵を読み込み中…';
      figure.appendChild(missing);
    }
    const tools = document.createElement('div');
    tools.className = 'nl-visual-illustration-tools';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'nl-visual-illustration-remove';
    remove.textContent = '本文から外す';
    remove.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      figure.remove();
      if (!editor.children.length) editor.appendChild(lineNode(''));
      syncToTextarea(true);
      editor.focus();
    });
    tools.appendChild(remove);
    figure.appendChild(tools);
    return figure;
  }

  function renderSource(value) {
    if (!editor) return;
    const source = normalize(value);
    editor.replaceChildren();
    const lines = source.split('\n');
    for (const line of lines) {
      const match = line.match(MARKER_RE);
      if (match) editor.appendChild(illustrationNode(line.trim(), match[1]));
      else editor.appendChild(lineNode(line));
    }
    if (!editor.children.length) editor.appendChild(lineNode(''));
  }

  function serializeTopLevel(node) {
    if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.classList.contains('nl-visual-illustration')) return String(node.dataset.marker || '');
    return normalize(node.innerText || node.textContent || '').replace(/\n$/u, '');
  }

  function serializeEditor() {
    if (!editor) return normalize(textarea.value);
    const parts = [];
    for (const node of editor.childNodes) {
      const value = serializeTopLevel(node);
      parts.push(...normalize(value).split('\n'));
    }
    return parts.join('\n');
  }

  function syncToTextarea(dispatchInput) {
    if (!active || !editor) return;
    const next = serializeEditor();
    if (textarea.value === next) return;
    syncing = true;
    textarea.value = next;
    if (dispatchInput) textarea.dispatchEvent(new Event('input', { bubbles: true }));
    syncing = false;
  }

  function topLevelNode(node) {
    let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (current && current.parentNode !== editor) current = current.parentNode;
    return current?.parentNode === editor ? current : null;
  }

  function offsetInside(node, container, offset) {
    if (!node || node.classList?.contains('nl-visual-illustration')) return 0;
    try {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(container, offset);
      return normalize(range.toString()).length;
    } catch {
      return 0;
    }
  }

  function canonicalOffset(container, offset) {
    if (!editor || !editor.contains(container)) return textarea.value.length;
    const top = topLevelNode(container);
    if (!top) return textarea.value.length;
    let total = 0;
    for (const child of editor.childNodes) {
      if (child === top) {
        total += offsetInside(top, container, offset);
        return Math.min(total, textarea.value.length);
      }
      total += serializeTopLevel(child).length + 1;
    }
    return Math.min(total, textarea.value.length);
  }

  function mirrorSelection() {
    if (!active || !editor) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    syncToTextarea(false);
    const start = canonicalOffset(range.startContainer, range.startOffset);
    const end = canonicalOffset(range.endContainer, range.endOffset);
    textarea.selectionStart = Math.min(start, end);
    textarea.selectionEnd = Math.max(start, end);
  }

  function selectedText() {
    if (!active || !editor) return '';
    const selection = window.getSelection();
    if (!selection?.rangeCount) return '';
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return '';
    return selection.toString();
  }

  function replaceSelection(replacement) {
    if (!active || !editor) return false;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    range.deleteContents();
    const text = document.createTextNode(String(replacement || ''));
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncToTextarea(true);
    mirrorSelection();
    return true;
  }

  function insertPlainText(text) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const value = normalize(text);
    const fragment = document.createDocumentFragment();
    const lines = value.split('\n');
    lines.forEach((line, index) => {
      if (index) fragment.appendChild(document.createElement('br'));
      fragment.appendChild(document.createTextNode(line));
    });
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  async function refreshFromTextarea() {
    if (!active || refreshing) return;
    refreshing = true;
    try {
      await loadAssets();
      renderSource(textarea.value);
    } catch (error) {
      console.error('episode visual illustration refresh failed', error);
    } finally {
      refreshing = false;
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refreshFromTextarea(); }, 80);
  }

  function interceptDecoration(event) {
    if (!active || !editor) return;
    const button = event.target.closest?.('.nl-author-popover button');
    if (!button) return;
    const label = button.textContent?.trim();
    if (label !== 'ルビ' && label !== '傍点') return;
    const text = selectedText();
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (label === 'ルビ') {
      if (text.length > 50 || /[\r\n《》｜]/u.test(text)) {
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
      replaceSelection(`｜${text}《${value}》`);
      return;
    }
    if (text.length > 80 || /[\r\n]/u.test(text)) {
      alert('傍点を付ける本文は1行・80文字以内で選択してください。');
      return;
    }
    replaceSelection(`《《${text}》》`);
  }

  function unchangedPublishedOwnerSave() {
    if (!initialSnapshot || document.body.dataset.collaborationEditor === 'true') return false;
    if (saveButton.textContent.trim() !== '保存') return false;
    const current = {
      title: titleInput.value,
      content: normalize(textarea.value),
      chapter: chapterSelect?.value ?? ''
    };
    return current.title === initialSnapshot.title &&
      current.content === initialSnapshot.content &&
      current.chapter === initialSnapshot.chapter;
  }

  async function activate() {
    if (active || !hasMarker(textarea.value)) return false;
    try {
      await loadAssets();
    } catch (error) {
      console.error('episode visual illustration editor unavailable', error);
      return false;
    }
    installStyle();
    editor = document.createElement('div');
    editor.id = 'novelightVisualBodyEditor';
    editor.className = 'nl-visual-body-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', '本文');
    editor.setAttribute('aria-multiline', 'true');
    textarea.insertAdjacentElement('afterend', editor);
    textarea.classList.add('nl-visual-source');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.tabIndex = -1;
    renderSource(textarea.value);
    initialSnapshot = {
      title: titleInput.value,
      content: normalize(textarea.value),
      chapter: chapterSelect?.value ?? ''
    };
    active = true;

    editor.addEventListener('input', () => syncToTextarea(true));
    editor.addEventListener('keyup', mirrorSelection);
    editor.addEventListener('mouseup', mirrorSelection);
    editor.addEventListener('focus', mirrorSelection);
    editor.addEventListener('paste', event => {
      event.preventDefault();
      insertPlainText(event.clipboardData?.getData('text/plain') || '');
      syncToTextarea(true);
      mirrorSelection();
    });
    document.addEventListener('selectionchange', mirrorSelection);
    document.addEventListener('click', interceptDecoration, true);
    return true;
  }

  textarea.addEventListener('input', () => {
    if (syncing) return;
    if (!active) {
      if (hasMarker(textarea.value)) void activate();
      return;
    }
    scheduleRefresh();
  });

  form.addEventListener('submit', event => {
    if (!active) return;
    syncToTextarea(false);
    if (!unchangedPublishedOwnerSave()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.NovelightAuthorDraft?.clearCurrentDraft?.();
    const episodeId = new URLSearchParams(location.search).get('id');
    location.href = 'episode.html?id=' + encodeURIComponent(episodeId || '');
  }, true);

  window.NovelightEpisodeVisualEditor = Object.freeze({
    isActive: () => active,
    selectedText,
    replaceSelection,
    sync: () => syncToTextarea(false),
    refresh: refreshFromTextarea
  });

  const waitForLoadedEpisode = () => {
    const number = document.getElementById('episodeNumber');
    if (number?.value) {
      if (hasMarker(textarea.value)) void activate();
      return;
    }
    setTimeout(waitForLoadedEpisode, 80);
  };
  waitForLoadedEpisode();
})();
