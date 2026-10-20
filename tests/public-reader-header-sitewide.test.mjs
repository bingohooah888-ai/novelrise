import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');
const clientSource = read('novelight-client.js');
const readerSource = read('novelight-reader-account.js');

test('public header loads one shared reader runtime', () => {
  assert.match(clientSource, /function installPublicReaderAccount\(\)/u);
  assert.match(clientSource, /installPublicReaderAccount\(\);/u);
  assert.match(clientSource, /script\.src = 'novelight-reader-account\.js'/u);
  assert.match(clientSource, /slug === 'index' \|\| slug === 'favorites'/u);
  assert.match(clientSource, /novelight-public-header-page/u);
  assert.match(clientSource, /script\[src\^="novelight-reader-account\.js"\]/u);
  for (const page of [
    'recommended.html',
    'new-arrivals.html',
    'light-seed.html',
    'search.html',
    'ranking.html',
    'novel.html',
    'episode.html',
    'author.html'
  ]) {
    const html = read(page);
    assert.match(html, /novelight-public-header-page/u, page);
    assert.match(html, /src="novelight-client\.js"/u, page);
    assert.match(html, /class="header-actions"/u, page);
  }
  assert.doesNotMatch(
    read('scout-lv10-campaign.html'),
    /novelight-public-header-page/u
  );
});

function fakeElement(tagName) {
  const node = {
    tagName: tagName.toUpperCase(),
    className: '',
    dataset: {},
    children: [],
    textContent: '',
    attributes: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    querySelector(selector) {
      if (selector !== '.nl-reader-mobile-items') return null;
      return this.children.find((child) => {
        return child.className === 'nl-reader-mobile-items';
      }) || null;
    }
  };
  return node;
}

async function simulateReaderHeader(classes) {
  const created = [];
  const nav = fakeElement('nav');
  const header = {
    querySelector(selector) {
      if (selector === '.nl-reader-account-bar') return created[0] || null;
      if (selector === '.mobile-menu nav') return nav;
      return null;
    },
    insertBefore(node) {
      created.push(node);
    }
  };
  const classSet = new Set(classes);
  const document = {
    readyState: 'complete',
    body: {
      classList: { contains: (value) => classSet.has(value) }
    },
    head: { appendChild() {} },
    getElementById() {
      return null;
    },
    createElement: fakeElement,
    querySelector(selector) {
      if (selector === '.workspace-top') return null;
      if (
        selector ===
        'header.site-header .public-header-inner .header-actions'
      ) {
        return header;
      }
      if (selector === '.site-header .header-actions') return header;
      return null;
    }
  };
  const supabase = {
    createClient() {
      return {
        auth: {
          async getSession() {
            return {
              error: null,
              data: { session: { user: { id: 'reader-1' } } }
            };
          }
        },
        from(table) {
          assert.equal(table, 'profiles');
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        error: null,
                        data: {
                          display_name: 'テスト読者',
                          avatar_path: 'reader-1/icon.webp'
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        },
        storage: {
          from() {
            return {
              getPublicUrl() {
                return { data: { publicUrl: 'https://cdn.test/icon.webp' } };
              }
            };
          }
        }
      };
    }
  };
  const window = { supabase };
  vm.runInNewContext(readerSource, { window, document, console });
  if (window.NovelightReaderAccount) {
    await window.NovelightReaderAccount.ready;
  }
  return { created, nav, window };
}

test('recommended page mounts bookshelf and avatar', async () => {
  const { created, nav } = await simulateReaderHeader([
    'novelight-public-header-page',
    'novelight-page-discovery-list'
  ]);
  assert.equal(created.length, 1);
  const [bookshelf, account] = created[0].children;
  assert.equal(bookshelf.href, 'favorites.html');
  assert.equal(bookshelf.textContent, '本棚');
  assert.equal(account.href, 'profile-settings.html');
  assert.equal(
    account.children[0].children[0].src,
    'https://cdn.test/icon.webp'
  );
  assert.equal(account.children[1].textContent, 'テスト読者');
  assert.equal(nav.children.length, 1);
  assert.deepEqual(
    Array.from(nav.children[0].children, (item) => item.href),
    ['favorites.html', 'profile-settings.html']
  );
});

test('campaign header is not modified', async () => {
  const { created, window } = await simulateReaderHeader([
    'novelight-page-scout-campaign'
  ]);
  assert.equal(created.length, 0);
  assert.equal(window.NovelightReaderAccount, undefined);
});

test('Home and Studio versions retain their special visual behavior', () => {
  assert.match(readerSource, /if \(isWorkspace\) \{/u);
  assert.match(readerSource, /if \(isHome \|\| isPublic\)/u);
  assert.match(readerSource, /novelight-public-dark/u);
  assert.match(readerSource, /nl-reader-mobile-items/u);
  assert.match(read('novelight-author-room.css'), /author-room-logo\.webp/u);
  assert.doesNotThrow(() => new vm.Script(clientSource));
  assert.doesNotThrow(() => new vm.Script(readerSource));
});
