import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import '../novelight-ai-bible-owner-studio.js';

const { attach } = globalThis.NovelightAiBibleOwnerStudio;
const OWNER = 'author-123';
const TOKEN = 'owner-token-for-test';

function node(tag) {
  return {
    tag,
    hidden: true,
    textContent: '',
    children: [],
    attributes: {},
    className: '',
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    remove() {
      this.removed = true;
    }
  };
}

function fixture({
  userId = OWNER,
  denied = false,
  changedAfterFetch = false,
  subscription = true
} = {}) {
  const main = node('main');
  const doc = {
    getElementById(id) {
      assert.equal(id, 'main-content');
      return main;
    },
    createElement: node
  };
  let checks = 0;
  let callback = null;
  let unsubscribed = false;
  const client = {
    auth: {
      async getSession() {
        checks += 1;
        const id = changedAfterFetch && checks > 2 ? 'different' : userId;
        return {
          data: {
            session: {
              access_token: TOKEN,
              user: { id }
            }
          },
          error: null
        };
      },
      onAuthStateChange(fn) {
        callback = fn;
        return subscription
          ? {
              data: {
                subscription: {
                  unsubscribe() {
                    unsubscribed = true;
                  }
                }
              }
            }
          : { data: {} };
      }
    }
  };
  const panel = {
    async mount({ target, novelId }) {
      assert.equal(novelId, '9');
      if (denied) return false;
      target.textContent = '非公開の本文と設定';
      target.hidden = false;
      return true;
    }
  };
  return {
    main,
    doc,
    client,
    panel,
    get listener() {
      return callback;
    },
    get unsubscribed() {
      return unsubscribed;
    }
  };
}

test('nonowners, denied RPC and wrong sessions add no DOM', async () => {
  for (const opts of [{ userId: 'other' }, { denied: true }]) {
    const f = fixture(opts);
    const ok = await attach({
      client: f.client,
      novelId: '9',
      ownerId: OWNER,
      doc: f.doc,
      panel: f.panel
    });
    assert.equal(ok, false);
    assert.equal(f.main.children.length, 0);
  }
});

test('owner verified before and after response receives private view once', async () => {
  const f = fixture();
  const args = {
    client: f.client,
    novelId: '9',
    ownerId: OWNER,
    doc: f.doc,
    panel: f.panel
  };
  assert.equal(await attach(args), true);
  assert.equal(f.main.children.length, 1);
  assert.equal(f.main.children[0].attributes['aria-label'], '作品カルテ（管理人限定・非公開）');
  assert.equal(
    f.main.children[0].children[0].textContent,
    '非公開の本文と設定'
  );
  assert.equal(await attach(args), false);
  assert.equal(f.main.children.length, 1);
  f.listener('SIGNED_OUT', null);
  assert.equal(f.main.children[0].removed, true);
  assert.equal(f.main.children[0].children[0].textContent, '');
});

test('account switch before append and missing auth listener fail closed', async () => {
  const switched = fixture({ changedAfterFetch: true });
  assert.equal(
    await attach({
      client: switched.client,
      novelId: '9',
      ownerId: OWNER,
      doc: switched.doc,
      panel: switched.panel
    }),
    false
  );
  assert.equal(switched.main.children.length, 0);
  const missing = fixture({ subscription: false });
  assert.equal(
    await attach({
      client: missing.client,
      novelId: '9',
      ownerId: OWNER,
      doc: missing.doc,
      panel: missing.panel
    }),
    false
  );
  assert.equal(missing.main.children.length, 0);
});

test('private notebook mounts only after existing novel ownership and notes load', async () => {
  const html = await readFile(new URL('../story-notes.html', import.meta.url), 'utf8');
  const verified = html.indexOf('result.data.user_id!==session.user.id');
  const notes = html.indexOf('await loadCharacters();await loadNotes();ready=true;');
  const mounted = html.indexOf('NovelightAiBibleOwnerStudio.attach(');
  assert.ok(verified >= 0 && notes > verified && mounted > notes);
  assert.ok(html.includes('src="novelight-ai-bible-owner-panel.js"'));
  assert.ok(html.includes('src="novelight-ai-bible-owner-studio.js"'));
  assert.equal(html.includes('id="novelight-ai-bible-public-button"'), false);
});
