import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  const second = first === -1 ? -1 : source.indexOf(before, first + before.length);
  if (first === -1 || second !== -1) {
    throw new Error(`${path}: expected exactly one replacement target`);
  }
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function ensureRuntimeScript(path) {
  const source = read(path);
  const tag = '<script src="novelight-synopsis-fold.js"></script>';
  if (source.includes(tag)) return;
  const close = '</body>';
  const index = source.lastIndexOf(close);
  if (index === -1) throw new Error(`${path}: missing </body>`);
  write(path, source.slice(0, index) + tag + source.slice(index));
}

replaceOnce(
  'ranking.html',
  '<div class="desc" style="white-space:pre-line">${esc(n.description||\'\')}</div>',
  '<div class="desc" style="white-space:pre-line" data-novelight-synopsis>${esc(n.description||\'\')}</div>'
);
replaceOnce(
  'search.html',
  '<div class="description" style="white-space:pre-line">${esc(n.description||\'\')}</div>',
  '<div class="description" style="white-space:pre-line" data-novelight-synopsis>${esc(n.description||\'\')}</div>'
);
replaceOnce(
  'author.html',
  '<div class="desc">${esc(x.description||\'\')}</div>',
  '<div class="desc" data-novelight-synopsis>${esc(x.description||\'\')}</div>'
);
replaceOnce(
  'novelight-bookshelf.js',
  '<div class="desc">${escapeHtml(novel.description || \'\')}</div>',
  '<div class="desc" data-novelight-synopsis>${escapeHtml(novel.description || \'\')}</div>'
);
replaceOnce(
  'curation.html',
  "const desc=node('p','',String(item.description||''));",
  "const desc=node('p','',String(item.description||''));desc.dataset.novelightSynopsis='';"
);
replaceOnce(
  'my-novels.html',
  '<div class="desc">${esc(n.description||\'\')}</div>',
  '<div class="desc" data-novelight-synopsis>${esc(n.description||\'\')}</div>'
);
replaceOnce(
  'novel.html',
  '<div class="description">${esc(novel.description||\'\')}</div>',
  '<div class="description" data-novelight-synopsis data-novelight-synopsis-lines="6">${esc(novel.description||\'\')}</div>'
);

for (const path of [
  'ranking.html',
  'search.html',
  'author.html',
  'favorites.html',
  'curation.html',
  'my-novels.html',
  'novel.html'
]) {
  ensureRuntimeScript(path);
}

const runtime = `(() => {
  'use strict';

  const SELECTOR = '[data-novelight-synopsis]';
  const STYLE_ID = 'novelight-synopsis-fold-style';
  let nextId = 0;
  let refreshFrame = 0;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.nl-synopsis-copy{display:block;}',
      '.nl-synopsis-host:not(.is-expanded) .nl-synopsis-copy{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--nl-synopsis-lines,3);overflow:hidden;}',
      '.nl-synopsis-host.is-expanded .nl-synopsis-copy{display:block;overflow:visible;}',
      '.nl-synopsis-toggle{display:inline-flex;align-items:center;margin-top:4px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:800;line-height:1.5;cursor:pointer;text-decoration:underline;text-underline-offset:3px;opacity:.82;}',
      '.nl-synopsis-toggle:hover{opacity:1;}',
      '.nl-synopsis-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:3px;}',
      '.nl-synopsis-toggle[hidden]{display:none!important;}'
    ].join('');
    document.head.appendChild(style);
  }

  function lineLimit(host) {
    const value = Number(host.dataset.novelightSynopsisLines || 3);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3;
  }

  function syncButton(host) {
    const button = host.querySelector(':scope > .nl-synopsis-toggle');
    if (!button) return;
    const expanded = host.classList.contains('is-expanded');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? '閉じる ▲' : 'あらすじをもっと見る ▼';
  }

  function refreshHost(host) {
    const copy = host.querySelector(':scope > .nl-synopsis-copy');
    const button = host.querySelector(':scope > .nl-synopsis-toggle');
    if (!copy || !button) return;

    const wasExpanded = host.classList.contains('is-expanded');
    if (wasExpanded) host.classList.remove('is-expanded');
    const overflow = copy.scrollHeight > copy.clientHeight + 1;
    button.hidden = !overflow;
    if (overflow && wasExpanded) host.classList.add('is-expanded');
    if (!overflow) host.classList.remove('is-expanded');
    host.dataset.novelightSynopsisOverflow = overflow ? 'true' : 'false';
    syncButton(host);
  }

  function scheduleRefresh() {
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      document.querySelectorAll(SELECTOR + '.nl-synopsis-host').forEach(refreshHost);
    });
  }

  function mount(host) {
    if (!(host instanceof HTMLElement)) return;
    if (host.dataset.novelightSynopsisMounted === 'true') return;
    host.dataset.novelightSynopsisMounted = 'true';
    host.classList.add('nl-synopsis-host');
    host.style.setProperty('--nl-synopsis-lines', String(lineLimit(host)));

    const copy = document.createElement('span');
    copy.className = 'nl-synopsis-copy';
    copy.id = 'novelight-synopsis-copy-' + String(++nextId);
    while (host.firstChild) copy.appendChild(host.firstChild);
    host.appendChild(copy);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nl-synopsis-toggle';
    button.hidden = true;
    button.setAttribute('aria-controls', copy.id);
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'あらすじをもっと見る ▼';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (host.dataset.novelightSynopsisOverflow !== 'true') return;
      host.classList.toggle('is-expanded');
      syncButton(host);
    });
    host.appendChild(button);
    requestAnimationFrame(() => refreshHost(host));
  }

  function scan(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches(SELECTOR)) mount(root);
    root.querySelectorAll?.(SELECTOR).forEach(mount);
  }

  function boot() {
    installStyles();
    scan(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof Element) scan(added);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    if (document.fonts?.ready) {
      document.fonts.ready.then(scheduleRefresh).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
`;
write('novelight-synopsis-fold.js', runtime);

const expected = [
  ['ranking.html', 'data-novelight-synopsis'],
  ['search.html', 'data-novelight-synopsis'],
  ['author.html', 'data-novelight-synopsis'],
  ['novelight-bookshelf.js', 'data-novelight-synopsis'],
  ['curation.html', 'dataset.novelightSynopsis'],
  ['my-novels.html', 'data-novelight-synopsis'],
  ['novel.html', 'data-novelight-synopsis-lines="6"']
];
for (const [path, token] of expected) {
  if (!read(path).includes(token)) throw new Error(`${path}: synopsis marker missing`);
}
console.log('Synopsis fold patch applied.');
