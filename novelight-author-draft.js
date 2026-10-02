(function () {
  'use strict';

  const PREFIX = 'novelight:episode-draft:v1:';
  const STYLE_ID = 'novelight-author-draft-style';

  function slug() {
    const file = window.location.pathname.split('/').pop() || '';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function draftKey() {
    const page = slug();
    if (page === 'episode-post') {
      const novelId = params().get('novel_id');
      return novelId ? `${PREFIX}new:${novelId}` : null;
    }
    if (page === 'episode-edit') {
      const episodeId = params().get('id');
      return episodeId ? `${PREFIX}edit:${episodeId}` : null;
    }
    return null;
  }

  function readDraft(key) {
    if (!key) return null;
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function writeDraft(key, value) {
    if (!key) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function removeDraft(key) {
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Local backup is best-effort and must never block writing.
    }
  }

  function clearCurrentDraft() {
    removeDraft(draftKey());
  }

  function values() {
    return {
      episodeNumber: Number(document.getElementById('episodeNumber')?.value || 0),
      title: document.getElementById('title')?.value || '',
      content: document.getElementById('content')?.value || '',
      savedAt: new Date().toISOString()
    };
  }

  function hasMeaningfulDraft(value) {
    return Boolean(value && (String(value.title || '').trim() || String(value.content || '').trim()));
  }

  function ensureProseRenderer() {
    if (window.NovelightProse || document.querySelector('script[data-novelight-prose]')) return;
    const script = document.createElement('script');
    script.src = 'novelight-prose.js';
    script.defer = true;
    script.dataset.novelightProse = 'true';
    document.head.appendChild(script);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-draft-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px;padding:12px 14px;border:1px solid #e2dccf;border-radius:10px;background:#fffdf8;flex-wrap:wrap}
      .nl-draft-state{color:#746858;font-size:12px;font-weight:700}.nl-draft-state strong{color:#4a3826}
      .nl-draft-actions{display:flex;gap:8px;flex-wrap:wrap}
      .nl-draft-button{min-height:38px;padding:8px 12px;border:1px solid #d6cab7;border-radius:8px;background:#fff;color:#4b3928;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
      .nl-draft-button.preview{background:#3d2d20;color:#fff;border-color:#3d2d20}
      .nl-draft-prose-help{flex:1 0 100%;padding-top:9px;border-top:1px solid #eadfce;color:#756753;font-size:12px;line-height:1.7}
      .nl-draft-prose-help code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#4a3826;background:#f7f0e5;padding:1px 4px;border-radius:4px}
      .nl-draft-restore{margin:0 0 18px;padding:14px 15px;border:1px solid #d8bb7c;border-radius:10px;background:#fff8e8;color:#5c4727;font-size:13px;line-height:1.7}
      .nl-draft-restore-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      .nl-preview-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(18,14,10,.72)}
      .nl-preview-card{width:min(820px,100%);max-height:88vh;overflow:auto;border-radius:16px;background:#fffdf8;padding:30px;box-shadow:0 24px 80px rgba(0,0,0,.24)}
      .nl-preview-kicker{color:#8c775b;font-size:11px;font-weight:900;letter-spacing:.12em}.nl-preview-title{margin:7px 0 22px;font-size:28px;line-height:1.5}.nl-preview-content{white-space:pre-wrap;word-break:break-word;font-size:17px;line-height:2}.nl-preview-close{position:sticky;top:0;float:right;margin:-8px -8px 8px 12px;padding:8px 11px;border:1px solid #d8ccb9;border-radius:8px;background:#fff;font:inherit;font-weight:900;cursor:pointer}
      #scheduleAt.nl-schedule-source{display:none!important}
      .nl-schedule-picker{display:grid;grid-template-columns:minmax(0,1fr) 88px 88px;gap:8px;align-items:center}
      .nl-schedule-picker input,.nl-schedule-picker select{width:100%;min-width:0}
      .nl-schedule-picker select{cursor:pointer}
      .nl-schedule-picker-help{grid-column:1/-1;color:#8a8176;font-size:11px;line-height:1.5}
      @media(max-width:640px){.nl-draft-tools{align-items:stretch}.nl-draft-actions{width:100%}.nl-draft-button{flex:1}.nl-preview-card{padding:22px 18px}.nl-preview-title{font-size:23px}.nl-preview-content{font-size:16px}}
    `;
    document.head.appendChild(style);
  }

  function waitUntilReady(timeout = 10000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const number = document.getElementById('episodeNumber');
        const title = document.getElementById('title');
        const content = document.getElementById('content');
        if (number && title && content && number.value) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function previewCurrent() {
    const value = values();
    const modal = document.createElement('div');
    modal.className = 'nl-preview-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const card = document.createElement('article');
    card.className = 'nl-preview-card';
    const close = document.createElement('button');
    close.className = 'nl-preview-close';
    close.type = 'button';
    close.textContent = '閉じる';
    const kicker = document.createElement('div');
    kicker.className = 'nl-preview-kicker';
    kicker.textContent = `PREVIEW ・ 第${value.episodeNumber || '—'}話`;
    const title = document.createElement('h2');
    title.className = 'nl-preview-title';
    title.textContent = value.title.trim() || '（タイトル未入力）';
    const content = document.createElement('div');
    content.className = 'nl-preview-content';
    content.textContent = value.content || '（本文未入力）';
    card.append(close, kicker, title, content);
    modal.appendChild(card);
    const dismiss = () => modal.remove();
    close.addEventListener('click', dismiss);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) dismiss();
    });
    document.addEventListener('keydown', function escape(event) {
      if (event.key !== 'Escape') return;
      dismiss();
      document.removeEventListener('keydown', escape);
    });
    document.body.appendChild(modal);
    window.NovelightProse?.enhance(modal);
  }

  function restoreDraft(value) {
    const number = document.getElementById('episodeNumber');
    const title = document.getElementById('title');
    const content = document.getElementById('content');
    if (number && Number(value.episodeNumber) > 0) number.value = String(value.episodeNumber);
    if (title) title.value = String(value.title || '');
    if (content) content.value = String(value.content || '');
    for (const node of [number, title, content]) {
      node?.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function insertRestorePrompt(key, stored) {
    if (!hasMeaningfulDraft(stored)) return;
    const current = values();
    if (
      slug() === 'episode-post' &&
      Number(stored.episodeNumber) > 0 &&
      Number(current.episodeNumber) > 0 &&
      Number(stored.episodeNumber) !== Number(current.episodeNumber)
    ) {
      return;
    }
    const form = document.getElementById('form');
    if (!form || document.getElementById('nlDraftRestore')) return;
    const box = document.createElement('div');
    box.id = 'nlDraftRestore';
    box.className = 'nl-draft-restore';
    box.textContent = `この端末に${formatTime(stored.savedAt)}の自動保存データがあります。`;
    const actions = document.createElement('div');
    actions.className = 'nl-draft-restore-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'nl-draft-button preview';
    restore.textContent = '復元する';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'nl-draft-button';
    discard.textContent = '破棄する';
    restore.addEventListener('click', () => {
      restoreDraft(stored);
      box.remove();
    });
    discard.addEventListener('click', () => {
      removeDraft(key);
      box.remove();
    });
    actions.append(restore, discard);
    box.appendChild(actions);
    form.prepend(box);
  }

  function installTools(key) {
    const form = document.getElementById('form');
    const buttons = form?.querySelector('.buttons');
    if (!form || !buttons || document.getElementById('nlDraftTools')) return null;
    const tools = document.createElement('div');
    tools.id = 'nlDraftTools';
    tools.className = 'nl-draft-tools';
    const state = document.createElement('div');
    state.className = 'nl-draft-state';
    state.innerHTML = '<strong>端末自動保存</strong> ・ 入力するとこのブラウザに保存されます';
    const actions = document.createElement('div');
    actions.className = 'nl-draft-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'nl-draft-button';
    save.textContent = '今すぐ端末保存';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'nl-draft-button preview';
    preview.textContent = 'プレビュー';
    const proseHelp = document.createElement('div');
    proseHelp.className = 'nl-draft-prose-help';
    proseHelp.innerHTML = '本文記法：ルビ <code>｜漢字《かんじ》</code> ／ 傍点 <code>《《強調》》</code>。任意のHTMLは実行されず文字として表示されます。';
    save.addEventListener('click', () => {
      const value = values();
      if (writeDraft(key, value)) state.innerHTML = `<strong>保存済み</strong> ・ ${formatTime(value.savedAt)}`;
    });
    preview.addEventListener('click', previewCurrent);
    actions.append(save, preview);
    tools.append(state, actions, proseHelp);
    buttons.insertAdjacentElement('beforebegin', tools);
    return state;
  }

  function installDesktopSchedulePicker() {
    const scheduleAt = document.getElementById('scheduleAt');
    const scheduleButton = document.getElementById('openScheduleSettings');
    if (!scheduleAt || !scheduleButton || scheduleAt.dataset.novelightDesktopPicker === 'true') return false;

    const desktopQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 721px) and (pointer: fine)')
      : null;
    if (desktopQuery ? !desktopQuery.matches : window.innerWidth <= 720) return false;

    scheduleAt.dataset.novelightDesktopPicker = 'true';
    scheduleAt.classList.add('nl-schedule-source');
    scheduleAt.tabIndex = -1;
    scheduleAt.setAttribute('aria-hidden', 'true');

    const picker = document.createElement('div');
    picker.className = 'nl-schedule-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', '予約公開日時');

    const date = document.createElement('input');
    date.id = 'nlScheduleDate';
    date.type = 'date';
    date.setAttribute('aria-label', '予約公開日');

    const hour = document.createElement('select');
    hour.setAttribute('aria-label', '予約公開時刻の時');
    for (let value = 0; value < 24; value += 1) {
      const padded = String(value).padStart(2, '0');
      hour.add(new Option(`${padded}時`, padded));
    }

    const minute = document.createElement('select');
    minute.setAttribute('aria-label', '予約公開時刻の分');
    for (let value = 0; value < 60; value += 1) {
      const padded = String(value).padStart(2, '0');
      minute.add(new Option(`${padded}分`, padded));
    }

    const help = document.createElement('div');
    help.className = 'nl-schedule-picker-help';
    help.textContent = '時・分はマウスホイールでも変更できます。';
    picker.append(date, hour, minute, help);
    scheduleAt.insertAdjacentElement('afterend', picker);

    const sourceLabel = document.querySelector('label[for="scheduleAt"]');
    if (sourceLabel) sourceLabel.setAttribute('for', date.id);

    function suggestedTime() {
      const value = new Date(Date.now() + 5 * 60 * 1000);
      hour.value = String(value.getHours()).padStart(2, '0');
      minute.value = String(value.getMinutes()).padStart(2, '0');
    }

    function syncBounds() {
      date.min = String(scheduleAt.min || '').slice(0, 10);
      date.max = String(scheduleAt.max || '').slice(0, 10);
    }

    function syncFromSource() {
      syncBounds();
      const match = String(scheduleAt.value || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/u);
      if (!match) {
        date.value = '';
        suggestedTime();
        return;
      }
      date.value = match[1];
      hour.value = match[2];
      minute.value = match[3];
    }

    function syncToSource() {
      const next = date.value ? `${date.value}T${hour.value}:${minute.value}` : '';
      if (scheduleAt.value === next) return;
      scheduleAt.value = next;
      scheduleAt.dispatchEvent(new Event('input', { bubbles: true }));
      scheduleAt.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function installWheel(select) {
      select.addEventListener('wheel', (event) => {
        if (!event.deltaY) return;
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + direction));
        if (next === select.selectedIndex) return;
        select.selectedIndex = next;
        syncToSource();
      }, { passive: false });
    }

    date.addEventListener('change', syncToSource);
    hour.addEventListener('change', syncToSource);
    minute.addEventListener('change', syncToSource);
    installWheel(hour);
    installWheel(minute);

    scheduleButton.addEventListener('click', () => window.queueMicrotask(syncFromSource));
    const scheduleCurrent = document.getElementById('scheduleCurrent');
    if (scheduleCurrent && typeof MutationObserver === 'function') {
      new MutationObserver(syncFromSource).observe(scheduleCurrent, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    syncFromSource();
    return true;
  }

  async function install() {
    if (!['episode-post', 'episode-edit'].includes(slug())) return false;
    const key = draftKey();
    if (!key) return false;
    const ready = await waitUntilReady();
    if (!ready) return false;
    installStyles();
    installDesktopSchedulePicker();
    ensureProseRenderer();
    const stored = readDraft(key);
    insertRestorePrompt(key, stored);
    const state = installTools(key);
    let timer = null;
    const save = () => {
      const value = values();
      writeDraft(key, value);
      if (state) state.innerHTML = `<strong>自動保存済み</strong> ・ ${formatTime(value.savedAt)}`;
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 700);
    };
    for (const id of ['episodeNumber', 'title', 'content']) {
      document.getElementById(id)?.addEventListener('input', schedule);
    }
    window.addEventListener('pagehide', save, { once: true });
    return true;
  }

  window.NovelightAuthorDraft = Object.freeze({
    readDraft,
    writeDraft,
    removeDraft,
    clearCurrentDraft,
    previewCurrent,
    install
  });

  void install();
})();