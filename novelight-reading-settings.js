(function attachNovelightReadingSettings(global) {
  'use strict';

  const STORAGE_KEY = 'novelight:reading-settings:v1';
  const DEFAULTS = Object.freeze({
    fontSize: 'standard',
    lineHeight: 'standard',
    theme: 'light',
    width: 'standard'
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
      width: normalizedChoice('width', source.width)
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
    return next;
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
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reading-settings-reset';
    reset.textContent = '標準に戻す';
    const note = document.createElement('p');
    note.className = 'reading-settings-note';
    note.textContent = 'この端末の読書表示だけを変更します。作品の評価やSCOUT判定には影響しません。';

    function commit(patch) {
      settings = apply({ ...settings, ...patch });
      save(settings);
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
    reset.addEventListener('click', () => {
      settings = apply(DEFAULTS);
      save(settings);
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
    mount
  });
})(window);
