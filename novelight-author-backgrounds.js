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

  const page = (global.location.pathname.split('/').pop() || '').toLowerCase();
  if (page === 'characters.html') {
    global.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('script[data-character-presentation-loader]')) return;
      const script = document.createElement('script');
      script.src = 'novelight-character-presentation.js';
      script.dataset.characterPresentationLoader = '1';
      document.body.appendChild(script);
    }, { once: true });
  }
})(window);