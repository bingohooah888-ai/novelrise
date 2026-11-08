import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile('novelight-episode-illustrations.js', 'utf8');
const post = await readFile('episode-post.html', 'utf8');

function harness(statuses = []) {
  let requests = 0;
  const document = {};
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.ownerDocument = document;
      this.children = [];
      this.listeners = {};
      this.hidden = false;
      this.textContent = '';
    }
    append(...items) {
      this.children.push(...items);
    }
    appendChild(item) {
      this.append(item);
    }
    replaceChildren(...items) {
      this.children = [...items];
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    addEventListener(name, handler) {
      (this.listeners[name] ||= []).push(handler);
    }
    dispatchEvent(event) {
      for (const handler of this.listeners[event.type] || []) handler(event);
    }
    querySelector(selector) {
      return selector === '[data-illustration-count]'
        ? (this.count ||= { textContent: '' })
        : null;
    }
  }
  document.createElement = (tag) => new Element(tag);
  const window = {
    dispatchEvent: () => {},
    NovelightEpisodeVisualEditor: null
  };
  const fetch = async () => {
    const status = statuses[requests++] ?? 200;
    return {
      status,
      ok: status === 200,
      json: async () =>
        status === 200
          ? { assets: [], aiUsage: false, limit: 10, novelId: 1 }
          : { error: 'simulated error' }
    };
  };
  runInNewContext(source, {
    window,
    document,
    fetch,
    console: { error: () => {} },
    setTimeout: (callback) => callback(),
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    }
  });
  const root = document.createElement('div');
  const textarea = document.createElement('textarea');
  textarea.value = '本文';
  const episode = { id: 123, novel_id: 1, status: 'draft', fromNewPost: true };
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'fake' } },
        error: null
      })
    }
  };
  const mount = () =>
    window.NovelightEpisodeIllustrations.mountEditor({
      client,
      root,
      episode,
      session: { access_token: 'fake' },
      textarea,
      isOwner: true
    });
  return {
    mount,
    root,
    textarea,
    window,
    requests: () => requests
  };
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

test('new post retries temporary 503 and keeps inline illustration controls visible', async () => {
  const ui = harness([503, 200]);
  const result = await ui.mount();
  assert.equal(ui.requests(), 2);
  assert.equal(ui.root.hidden, false);
  assert.deepEqual(Array.from(result.assets), []);
  assert.ok(find(ui.root, (node) => node.textContent === '挿絵をアップロード'));
  assert.equal(
    find(ui.root, (node) => node.textContent === '挿絵を再読み込み'),
    null
  );
});

test('authorization failures are not silently retried or hidden; manual recovery works', async () => {
  const ui = harness([403, 200]);
  ui.root.hidden = true;
  const result = await ui.mount();
  assert.equal(result.retryPending, true);
  assert.equal(typeof result.retry, 'function');
  assert.equal(ui.requests(), 1);
  assert.equal(ui.root.hidden, false);
  const retry = find(
    ui.root,
    (node) => node.textContent === '挿絵を再読み込み'
  );
  const draft = find(ui.root, (node) => node.tag === 'a');
  assert.ok(retry);
  assert.equal(draft.href, 'episode-edit.html?id=123');
  await retry.listeners.click[0]();
  assert.equal(ui.requests(), 2);
  assert.equal(result.retryPending, false);
  assert.ok(find(ui.root, (node) => node.textContent === '挿絵をアップロード'));
  await result.retry();
  assert.equal(ui.requests(), 2);
});

test('repeat failures retain the retry button and draft-edit fallback', async () => {
  const ui = harness([403, 403, 200]);
  await ui.mount();
  const retry = find(
    ui.root,
    (node) => node.textContent === '挿絵を再読み込み'
  );
  await retry.listeners.click[0]();
  assert.ok(find(ui.root, (node) => node === retry));
  assert.ok(find(ui.root, (node) => node.href === 'episode-edit.html?id=123'));
  await retry.listeners.click[0]();
  assert.ok(find(ui.root, (node) => node.textContent === '挿絵をアップロード'));
});

test('inserting an illustration marks the manuscript as changed', () => {
  const ui = harness();
  const marker =
    '[[NOVELIGHT_ILLUSTRATION:01234567-89ab-4cde-8f01-23456789abcd]]';
  let inputEvents = 0;
  ui.textarea.selectionStart = 1;
  ui.textarea.selectionEnd = 1;
  ui.textarea.focus = () => {};
  ui.textarea.addEventListener('input', () => {
    inputEvents++;
  });
  ui.window.NovelightEpisodeIllustrations.insertMarker(ui.textarea, marker);
  assert.ok(ui.textarea.value.includes(marker));
  assert.equal(inputEvents, 1);
});

test('new episode reuses an autosaved draft and obtains a current session', () => {
  assert.match(post, /pendingDraftId\s*&&\s*!dirty\s*&&\s*!chapterDirty/u);
  assert.match(post, /auth=await client\.auth\.getSession\(\)/u);
  assert.match(post, /fromNewPost:true/u);
  assert.match(post, /if\(editRevision===revision\)/u);
});
