import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import '../novelight-ai-bible-author-workspace.js';
import '../novelight-ai-bible-owner-outline.js';
import '../novelight-ai-bible-owner-panel.js';
import '../novelight-ai-bible-owner-studio.js';

const { attach } = globalThis.NovelightAiBibleOwnerStudio;
const OWNER = 'author-synthetic-123';
const TOKEN = 'synthetic-token-not-real';

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.removed = false;
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((node) => node.textContent).join('');
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
  remove() {
    this.removed = true;
  }
}

function find(element, className) {
  if (element.className === className) return element;
  for (const child of element.children) {
    const found = find(child, className);
    if (found) return found;
  }
  return null;
}

function response(novelId = 9, summary = '作者本人の非公開設定') {
  return {
    novelId,
    aiGenerated: false,
    characters: [{ name: '凛', aliases: [] }],
    notes: [{ type: 'plot', title: '第一幕', body: summary }],
    facts: [
      {
        kind: 'event',
        key: '出発',
        confirmed: [
          {
            sourceEpisodeId: 100,
            payload: { summary: '朝の出発', evidence: '' }
          }
        ],
        suggestions: []
      }
    ]
  };
}

function rig({
  owner = OWNER,
  token = TOKEN,
  enabled = true,
  wrongNovel = false
} = {}) {
  const main = new Element('main', null);
  const doc = {
    getElementById(id) {
      assert.equal(id, 'main-content');
      return main;
    },
    createElement(tag) {
      return new Element(tag, doc);
    }
  };
  let session =
    owner && token ? { user: { id: owner }, access_token: token } : null;
  let listener;
  let unsubscribed = false;
  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                unsubscribed = true;
              }
            }
          }
        };
      }
    }
  };
  let reads = 0;
  const requests = [];
  let fail = false;
  let deferredRead = null;
  let marker = '初回の非公開メモ';
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    reads += 1;
    if (deferredRead) return deferredRead;
    return {
      ok: enabled && !fail,
      json: async () => response(wrongNovel ? 10 : 9, marker)
    };
  };
  return {
    doc,
    main,
    client,
    fetcher,
    requests,
    get reads() {
      return reads;
    },
    get unsubscribed() {
      return unsubscribed;
    },
    set marker(value) {
      marker = value;
    },
    set fail(value) {
      fail = value;
    },
    set deferredRead(value) {
      deferredRead = value;
    },
    revoke() {
      session = null;
      listener?.('SIGNED_OUT', null);
    },
    switchOwner() {
      session = { user: { id: 'other-user' }, access_token: 'new-token' };
    }
  };
}

function args(f) {
  return {
    client: f.client,
    doc: f.doc,
    novelId: '9',
    ownerId: OWNER,
    fetcher: f.fetcher
  };
}

test('real owner studio uses the owner-gated GET once and exposes reload UI', async () => {
  const f = rig();
  assert.equal(await attach(args(f)), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/ai-owner-novel-bible?novel_id=9');
  assert.equal(f.requests[0].options.method, 'GET');
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.requests[0].options.credentials, 'same-origin');
  assert.equal(f.main.children.length, 1);
  const section = f.main.children[0];
  assert.equal(
    section.attributes['aria-label'],
    '作品カルテ（管理人限定・非公開）'
  );
  assert.match(section.textContent, /初回の非公開メモ/);
  assert.match(section.textContent, /作品カルテを読み込みました/);
  const reload = find(section, 'novelight-ai-bible-reload');
  assert.ok(reload);
  assert.equal(reload.textContent, '再読込');
  f.marker = '再読込後の非公開メモ';
  reload.listeners.get('click')();
  await delay(0);
  assert.equal(f.requests.length, 2);
  assert.match(section.textContent, /再読込後の非公開メモ/);
  assert.doesNotMatch(section.textContent, /初回の非公開メモ/);
  assert.equal(await attach(args(f)), false);
  assert.equal(f.requests.length, 2);
  f.revoke();
  assert.equal(section.removed, true);
  assert.equal(section.textContent, '');
  assert.equal(f.unsubscribed, true);
});

test('server default denial or malformed response creates no author section', async () => {
  for (const f of [
    rig({ enabled: false }),
    rig({ wrongNovel: true }),
    rig({ owner: 'not-owner' })
  ]) {
    assert.equal(await attach(args(f)), false);
    assert.equal(f.main.children.length, 0);
    assert.equal(f.main.textContent, '');
    if (f.requests.length) {
      assert.equal(f.requests[0].options.method, 'GET');
      assert.equal(f.requests.length, 1);
    }
  }
});

test('server failure on reload removes old private text and permits retry', async () => {
  const f = rig();
  assert.equal(await attach(args(f)), true);
  const section = f.main.children[0];
  const reload = find(section, 'novelight-ai-bible-reload');
  f.fail = true;
  reload.listeners.get('click')();
  await delay(0);
  assert.match(section.textContent, /読み込みに失敗しました/);
  assert.doesNotMatch(section.textContent, /初回の非公開メモ/);
  f.fail = false;
  f.marker = '復旧後の非公開メモ';
  reload.listeners.get('click')();
  await delay(0);
  assert.match(section.textContent, /復旧後の非公開メモ/);
  assert.equal(f.reads, 3);
  f.revoke();
});

test('account switch while an owner GET is in flight never displays old data', async () => {
  const f = rig();
  let resolveRequest;
  f.deferredRead = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const pending = attach(args(f));
  await delay(0);
  assert.equal(f.requests.length, 1);
  f.switchOwner();
  resolveRequest({
    ok: true,
    json: async () => response(9, 'SECRET_AFTER_ACCOUNT_SWITCH')
  });
  assert.equal(await pending, false);
  assert.equal(f.main.children.length, 0);
  assert.doesNotMatch(f.main.textContent, /SECRET_AFTER_ACCOUNT_SWITCH/);
});

test('sign-out during background reload hides content and cancels late results', async () => {
  const f = rig();
  assert.equal(await attach(args(f)), true);
  const section = f.main.children[0];
  let resolveRequest;
  f.deferredRead = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const button = find(section, 'novelight-ai-bible-reload');
  button.listeners.get('click')();
  await delay(0);
  f.revoke();
  resolveRequest({
    ok: true,
    json: async () => response(9, 'SHOULD_NEVER_BE_DISPLAYED')
  });
  await delay(0);
  assert.equal(section.removed, true);
  assert.equal(section.textContent, '');
  assert.equal(f.unsubscribed, true);
});

test('declined initial preview never exposes controls, a review or a paid call', async () => {
  const f = rig({ enabled: false });
  assert.equal(await attach(args(f)), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.method, 'GET');
  assert.equal(f.main.children.length, 0);
  assert.equal(find(f.main, 'novelight-ai-bible-reload'), null);
});
