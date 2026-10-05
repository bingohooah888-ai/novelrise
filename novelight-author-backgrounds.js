(function (global) {
  'use strict';
  const key = 'novelight_author_background';
  const normalize = (value) => value === 'simple' ? 'simple' : 'decorative';
  function apply(value) {
    const mode = normalize(value);
    document.documentElement.dataset.authorBackground = mode;
    return mode;
  }
  function get() {
    try { return normalize(global.localStorage.getItem(key)); }
    catch { return 'decorative'; }
  }
  function set(value) {
    const mode = apply(value);
    try { global.localStorage.setItem(key, mode); return true; }
    catch { return false; }
  }
  function installCharacterSurfaceAdmin() {
    const pathname = String(global.location?.pathname || '');
    if (!/(^|\/)characters\.html$/u.test(pathname)) return;
    if (document.querySelector('script[data-novelight-character-surface-admin]')) return;
    const script = document.createElement('script');
    script.src = 'novelight-character-surface-admin.js';
    script.async = false;
    script.dataset.novelightCharacterSurfaceAdmin = 'true';
    document.head.appendChild(script);
  }
  apply(get());
  installCharacterSurfaceAdmin();
  global.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(get());
  });
  global.NovelightAuthorBackground = Object.freeze({ get, set });
})(window);
