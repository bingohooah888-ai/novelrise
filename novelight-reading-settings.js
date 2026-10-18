(function attachNovelightReadingSettings(global) {
  'use strict';

  const STORAGE_KEY = 'novelight:reading-settings:v1';
  const DEFAULTS = Object.freeze({
    fontSize: 'standard',
    lineHeight: 'standard',
    theme: 'light',
    width: 'standard',
    writingMode: 'horizontal'
  });
  const PRESETS = Object.freeze({
    fontSize: Object.freeze({
      small: '15px',
      standard: '17px',
      large: '19px',
      xlarge: '21px'
    }),
    lineHeight: Object.freeze({
      compact: '1.7',
      standard: '2.1',
      relaxed: '2.5'
    }),
    theme: Object.freeze({
      light: 'light',
      dark: 'dark'
    }),
    width: Object.freeze({
      narrow: '680px',
      standard: '820px',
      wide: '1040px'
    }),
    writingMode: Object.freeze({
      horizontal: 'horizontal',
      vertical: 'vertical'
    })
  });

  function ensureProseRenderer() {
    const documentRef = global.document;
    if (!documentRef?.head || global.NovelightProse) return;
    if (documentRef.querySelector('script[data-novelight-prose]')) return;
    const script = documentRef.createElement('script');
    script.src = 'novelight-prose.js';
    script.defer = true;
    script.dataset.novelightProse = 'true';
    documentRef.head.appendChild(script);
  }

  function ensureReaderTts() {
    const documentRef = global.document;
    if (!documentRef?.head) return;
    if (!documentRef.querySelector('link[data-novelight-reader-tts]')) {
      const stylesheet = documentRef.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'novelight-reader-tts.css';
      stylesheet.dataset.novelightReaderTts = 'true';
      documentRef.head.appendChild(stylesheet);
    }
    if (global.NovelightReaderTts) return;
    if (documentRef.querySelector('script[data-novelight-reader-tts]')) return;
    const script = documentRef.createElement('script');
    script.src = 'novelight-reader-tts.js';
    script.defer = true;
    script.dataset.novelightReaderTts = 'true';
    documentRef.head.appendChild(script);
  }

  function normalizedChoice(group, value) {
    return Object.prototype.hasOwnProperty.call(PRESETS[group], value)
      ? value
      : DEFAULTS[group];
  }

  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      fontSize: normalizedChoice('fontSize', source.fontSize),
      lineHeight: normalizedChoice('lineHeight', source.lineHeight),
      theme: normalizedChoice('theme', source.theme),
      width: normalizedChoice('width', source.width),
      writingMode: normalizedChoice('writingMode', source.writingMode)
    };
  }

  function load() {
    try {
      const stored = global.localStorage.getItem(STORAGE_KEY);
      return normalize(stored ? JSON.parse(stored) : null);
    } catch (error) {
      console.warn('reading settings could not be loaded', error);
      return { ...DEFAULTS };
    }
  }

  function save(settings) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('reading settings could not be saved', error);
    }
  }

  function apply(settings) {
    const next = normalize(settings);
    const body = document.body;
    body.style.setProperty('--reader-font-size', PRESETS.fontSize[next.fontSize]);
    body.style.setProperty('--reader-line-height', PRESETS.lineHeight[next.lineHeight]);
    body.style.setProperty('--reader-max-width', PRESETS.width[next.width]);
    body.dataset.readingTheme = PRESETS.theme[next.theme];
    body.dataset.readingDirection = PRESETS.writingMode[next.writingMode];
    return next;
  }

  function clampProgress(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function contentProgress(content) {
    if (!content) return 0;
    if (document.body.dataset.readingDirection === 'vertical') {
      const total = Math.max(1, content.scrollWidth);
      return clampProgress((Math.abs(content.scrollLeft) + content.clientWidth) / total);
    }
    const rect = content.getBoundingClientRect();
    const absoluteTop = global.scrollY + rect.top;
    const height = Math.max(content.scrollHeight, rect.height, 1);
    const viewportBottom = global.scrollY + global.innerHeight;
    return clampProgress((viewportBottom - absoluteTop) / height);
  }

  function seekProgress(content, ratio, behavior = 'auto') {
    if (!content) return;
    const progress = clampProgress(ratio);
    if (document.body.dataset.readingDirection === 'vertical') {
      const maxScroll = Math.max(0, content.scrollWidth - content.clientWidth);
      const offset = Math.min(
        maxScroll,
        Math.max(0, content.scrollWidth * progress - content.clientWidth * 0.35)
      );
      content.scrollTo({ left: -offset, behavior });
      return;
    }
    const absoluteTop = global.scrollY + content.getBoundingClientRect().top;
    global.scrollTo({
      top: absoluteTop + Math.max(0, content.scrollHeight * progress - global.innerHeight * 0.35),
      behavior
    });
  }

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  function selectControl(labelText, value, options) {
    const label = document.createElement('label');
    label.className = 'reading-setting-field';
    const title = document.createElement('span');
    title.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'reading-setting-select';
    for (const [optionValue, optionLabel] of options) {
      select.append(option(optionValue, optionLabel));
    }
    select.value = value;
    label.append(title, select);
    return { label, select };
  }

  function writingModeControl(value) {
    const field = document.createElement('div');
    field.className = 'reading-setting-field reading-setting-writing-mode';
    const title = document.createElement('span');
    title.id = 'readingWritingModeLabel';
    title.textContent = '本文の向き';
    const group = document.createElement('div');
    group.className = 'reading-writing-mode-buttons';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', title.id);
    const buttons = {};
    for (const [key, label] of [['horizontal', '横書き'], ['vertical', '縦書き']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reading-writing-mode-button';
      button.dataset.writingMode = key;
      button.textContent = label;
      buttons[key] = button;
      group.append(button);
    }
    const sync = (selected) => {
      for (const [key, button] of Object.entries(buttons)) {
        button.setAttribute('aria-pressed', String(key === selected));
      }
    };
    sync(value);
    field.append(title, group);
    return { field, buttons, sync };
  }

  function mount() {
    ensureProseRenderer();
    ensureReaderTts();
    const mountPoint = document.getElementById('readingSettingsMount');
    if (!mountPoint || mountPoint.dataset.mounted === 'true') return;
    mountPoint.dataset.mounted = 'true';

    let settings = apply(load());
    const details = document.createElement('details');
    details.className = 'reading-settings';
    const summary = document.createElement('summary');
    summary.className = 'reading-settings-summary';
    summary.textContent = '読書表示設定';
    const panel = document.createElement('div');
    panel.className = 'reading-settings-panel';

    const font = selectControl('文字サイズ', settings.fontSize, [
      ['small', '小'],
      ['standard', '標準'],
      ['large', '大'],
      ['xlarge', '特大']
    ]);
    const line = selectControl('行間', settings.lineHeight, [
      ['compact', '狭め'],
      ['standard', '標準'],
      ['relaxed', '広め']
    ]);
    const theme = selectControl('読書テーマ', settings.theme, [
      ['light', '明るい'],
      ['dark', '暗い']
    ]);
    const width = selectControl('本文横幅', settings.width, [
      ['narrow', '狭め'],
      ['standard', '標準'],
      ['wide', '広め']
    ]);
    const writingMode = writingModeControl(settings.writingMode);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reading-settings-reset';
    reset.textContent = '標準に戻す';
    const note = document.createElement('p');
    note.className = 'reading-settings-note';
    note.textContent = 'この端末の読書表示だけを変更します。作品の評価やSCOUT判定には影響しません。';

    function commit(patch) {
      const changed = patch.writingMode && patch.writingMode !== settings.writingMode;
      const content = changed ? document.querySelector('#card .content') : null;
      const progress = content ? contentProgress(content) : null;
      settings = apply({ ...settings, ...patch });
      save(settings);
      writingMode.sync(settings.writingMode);
      if (changed && content) {
        global.requestAnimationFrame(() => {
          seekProgress(content, progress);
          document.dispatchEvent(new Event('novelight-reading-mode-changed'));
        });
      }
    }

    font.select.addEventListener('change', () => {
      commit({ fontSize: font.select.value });
    });
    line.select.addEventListener('change', () => {
      commit({ lineHeight: line.select.value });
    });
    theme.select.addEventListener('change', () => {
      commit({ theme: theme.select.value });
    });
    width.select.addEventListener('change', () => {
      commit({ width: width.select.value });
    });
    for (const [key, button] of Object.entries(writingMode.buttons)) {
      button.addEventListener('click', () => commit({ writingMode: key }));
    }
    reset.addEventListener('click', () => {
      commit(DEFAULTS);
      font.select.value = settings.fontSize;
      line.select.value = settings.lineHeight;
      theme.select.value = settings.theme;
      width.select.value = settings.width;
    });

    panel.append(
      font.label,
      line.label,
      theme.label,
      width.label,
      writingMode.field,
      reset,
      note
    );
    details.append(summary, panel);
    mountPoint.append(details);

    global.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      settings = apply(load());
      font.select.value = settings.fontSize;
      line.select.value = settings.lineHeight;
      theme.select.value = settings.theme;
      width.select.value = settings.width;
      writingMode.sync(settings.writingMode);
    });
  }

  global.NovelightReadingSettings = Object.freeze({
    STORAGE_KEY,
    DEFAULTS,
    PRESETS,
    normalize,
    load,
    save,
    apply,
    contentProgress,
    seekProgress,
    mount
  });
})(window);
