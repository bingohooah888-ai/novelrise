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
  apply(get());
  global.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(get());
  });
  global.NovelightAuthorBackground = Object.freeze({ get, set });
})(window);
