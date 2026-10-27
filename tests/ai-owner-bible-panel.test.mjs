import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-owner-panel.js';

const { mount, render } = globalThis.NovelightAiBibleOwnerPanel;

function fakeNode(tag = 'div') {
  return {
    tag,
    hidden: true,
    children: [],
    className: '',
    textContent: '',
    appendChild(node) {
      this.children.push(node);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    }
  };
}

const doc = {
  createElement: fakeNode,
  createDocumentFragment() {
    return fakeNode('fragment');
  }
};

function getText(tree) {
  return [tree.textContent, ...(tree.children || []).map(getText)].join(' ');
}

test('owner-only novel bible UI never renders draft notes without a login', async () => {
  const target = fakeNode();
  let requests = 0;
  const ok = await mount({
    target,
    novelId: 17,
    doc,
    client: { auth: { async getSession() { return { data: { session: null } }; } } },
    fetcher() {
      requests += 1;
    }
  });
  assert.equal(ok, false);
  assert.equal(target.hidden, true);
  assert.equal(requests, 0);
});

test('denied API response leaves private admin UI hidden', async () => {
  const target = fakeNode();
  const ok = await mount({
    target,
    novelId: 17,
    doc,
    client: {
      auth: {
        async getSession() {
          return { data: { session: { access_token: 'example' } } };
        }
      }
    },
    async fetcher(url, opts) {
      assert.equal(url, '/api/ai-owner-novel-bible?novel_id=17');
      assert.equal(opts.headers.Authorization, 'Bearer example');
      return { ok: false, status: 404 };
    }
  });
  assert.equal(ok, false);
  assert.equal(target.hidden, true);
});

test('admin-only render uses text nodes instead of HTML injection', () => {
  const target = fakeNode();
  const result = render({
    target,
    doc,
    payload: {
      characters: [{ name: '<img src=x onerror=alert(1)>' }],
      notes: [{ title: '<script>alert(1)</script>', body: 'PRIVATE END' }],
      facts: [{ kind: 'world', key: 'setting' }]
    }
  });
  assert.equal(result, true);
  assert.equal(target.hidden, false);
  const text = getText(target);
  assert.match(text, /PRIVATE END/);
  assert.match(text, /<script>/);
  assert.ok(target.children[0].tag === 'fragment');
});

test('oversized or malformed payloads never render', () => {
  const target = fakeNode();
  assert.equal(
    render({ target, doc, payload: { notes: [], characters: [], facts: null } }),
    false
  );
  assert.equal(target.hidden, true);
});
