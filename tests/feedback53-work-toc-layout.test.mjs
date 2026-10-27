import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';

const load = (name) =>
  readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const detail = load('novelight-novel-detail.js');
const reader = load('novelight-work-navigation.js');

const start = detail.indexOf(
  '  function buildToc(items, id, { isOwner = false } = {}) {'
);
const end = detail.indexOf('\n\n  function optimizedImageUrl', start);
assert.ok(
  start >= 0 && end > start,
  'owner-aware TOC function must be present'
);
const buildTocSource = detail.slice(start, end);

function element(tag, className = '', text = '') {
  const el = {
    tag,
    className,
    textContent: String(text),
    children: [],
    classes: [],
    appendChild(child) {
      this.children.push(child);
    },
    append(...children) {
      this.children.push(...children);
    }
  };
  el.classList = {
    add(value) {
      el.classes.push(value);
    }
  };
  return el;
}

function render(items, progress, options) {
  let progressReads = 0;
  const buildToc = runInNewContext(buildTocSource + '\nbuildToc', {
    node: element,
    readProgress() {
      progressReads += 1;
      return progress;
    },
    tocDisplayTitle(title) {
      return title;
    }
  });
  return {
    root: buildToc(items, '257', options),
    progressReads: () => progressReads
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function manyEpisodes() {
  const items = [
    {
      type: 'episode',
      row: { id: '0', number: 0, title: '序章', href: '/episode.html?id=0' }
    }
  ];
  for (let chapter = 1; chapter <= 4; chapter += 1) {
    items.push({ type: 'chapter', title: '第' + chapter + '章' });
    for (let index = 1; index <= 75; index += 1) {
      const number = (chapter - 1) * 75 + index;
      items.push({
        type: 'episode',
        row: {
          id: String(number),
          number,
          title: 'タイトル' + number,
          href: '/episode.html?id=' + number
        }
      });
    }
  }
  return items;
}

test('PC TOC fills the row without sticking and scrolls its own list', () => {
  const css = detail.match(/\.nl-work-toc-list\{([^}]+)\}/u)?.[1];
  assert.ok(css, 'TOC layout CSS exists');
  assert.match(css, /display:grid/u);
  assert.match(css, /grid-auto-rows:max-content/u);
  assert.match(css, /align-content:start/u);
  assert.match(css, /flex:1 1 0%;height:0;min-height:0;overflow-y:auto/u);
  assert.match(detail, /\.nl-work-detail-grid\{[^}]*align-items:stretch/u);
  assert.match(
    detail,
    /\.nl-work-detail-center\{[^}]*display:flex;flex-direction:column/u
  );
  assert.match(
    detail,
    /\.nl-work-detail-toc\{position:static;height:100%;min-height:0/u
  );
});

test('all 301 episode links stay in the correct chapter or flat list', () => {
  const { root } = render(manyEpisodes(), {
    episodeId: '205',
    episodeNumber: 205
  });
  const links = descendants(root).filter((item) => item.tag === 'a');
  const chapters = root.children.filter((item) => item.tag === 'details');
  assert.equal(links.length, 301);
  assert.equal(
    root.children[0].tag,
    'a',
    'episode without a chapter remains visible'
  );
  assert.equal(chapters.length, 4);
  for (let index = 0; index < 4; index += 1) {
    const chapterLinks = descendants(chapters[index]).filter(
      (item) => item.tag === 'a'
    );
    assert.equal(
      chapterLinks.length,
      75,
      'all episodes belong to chapter ' + (index + 1)
    );
    assert.equal(
      chapters[index].open,
      index === 2,
      'reader progress opens only chapter 3'
    );
  }
  assert.equal(links[0].href, '/episode.html?id=0');
  assert.equal(links.at(-1).href, '/episode.html?id=300');
});

test('owner opens the first chapter and ignores old progress', () => {
  const result = render(
    manyEpisodes(),
    { episodeId: '205', episodeNumber: 205 },
    { isOwner: true }
  );
  const chapters = result.root.children.filter(
    (item) => item.tag === 'details'
  );
  assert.deepEqual(
    chapters.map((item) => Boolean(item.open)),
    [true, false, false, false]
  );
  assert.equal(result.progressReads(), 0);
  assert.equal(
    descendants(result.root).filter((item) => item.tag === 'a').length,
    301
  );
});

test('readers open the current or first chapter', () => {
  const recent = render(manyEpisodes(), {
    episodeId: '205',
    episodeNumber: 205
  });
  assert.deepEqual(
    recent.root.children
      .filter((item) => item.tag === 'details')
      .map((item) => Boolean(item.open)),
    [false, false, true, false]
  );
  const fresh = render(manyEpisodes(), null);
  assert.deepEqual(
    fresh.root.children
      .filter((item) => item.tag === 'details')
      .map((item) => Boolean(item.open)),
    [true, false, false, false]
  );
});

test('desktop and mobile use owner mode and reader navigation scrolls', () => {
  assert.match(
    detail,
    /installMobileToc\(items, id, actions, viewerOwnsNovel\)/u
  );
  assert.match(
    detail,
    /sheet\.append\(head, buildToc\(items, id, \{ isOwner \}\)\)/u
  );
  assert.match(
    detail,
    /toc\.append\(tocHead, buildToc\(items, id, \{ isOwner: viewerOwnsNovel \}\)\)/u
  );
  assert.match(detail, /\.nl-work-toc-sheet\{[^}]*overflow:auto/u);
  assert.match(reader, /\.nl-worknav-episode-list\{[^}]*overflow:auto/u);
  assert.match(
    reader,
    /currentBody\.appendChild\(makeEpisodeLink\(row, currentEpisodeId\)\)/u
  );
});
