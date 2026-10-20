import assert from 'node:assert/strict';
import vm from 'node:vm';

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
    querySelector() {
      return null;
    }
  };
  return node;
}

export async function simulateReaderHeader(classes, readerSource) {
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

