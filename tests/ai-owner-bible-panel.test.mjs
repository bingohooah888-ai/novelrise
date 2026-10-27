import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-owner-panel.js';

const { mount, render } = globalThis.NovelightAiBibleOwnerPanel;

function fakeNode() {
  return {
    hidden: true,
    textContent: 'stale secret'
  };
}

test('owner-only novel bible UI clears old notes without a login', async () => {
  const target = fakeNode();
  let requests = 0;
  const ok = await mount({
    target,
    novelId: 17,
    client: {
      auth: {
        async getSession() {
          return { data: { session: null } };
        }
      }
    },
    fetcher() {
      requests += 1;
    }
  });
  assert.equal(ok, false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
  assert.equal(requests, 0);
});

test('denied endpoint never renders unpublished notes', async () => {
  const target = fakeNode();
  const ok = await mount({
    target,
    novelId: 17,
    client: {
      auth: {
        async getSession() {
          return { data: { session: { access_token: 'example' } } };
        }
      }
    },
    async fetcher(url, options) {
      assert.equal(url, '/api/ai-owner-novel-bible?novel_id=17');
      assert.equal(options.headers.Authorization, 'Bearer example');
      return { ok: false, status: 404 };
    }
  });
  assert.equal(ok, false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});

test('author-owned content is assigned literally through textContent', () => {
  const target = fakeNode();
  const ok = render({
    target,
    payload: {
      characters: [{ name: '<img src=x onerror=alert(1)>' }],
      notes: [{ title: '<script>alert(1)</script>', body: 'PRIVATE END' }],
      facts: [{ kind: 'world', key: 'setting' }]
    }
  });
  assert.equal(ok, true);
  assert.equal(target.hidden, false);
  assert.match(target.textContent, /PRIVATE END/);
  assert.equal(target.textContent.includes('<script>alert(1)</script>'), true);
});

test('oversized or malformed payloads fail closed', () => {
  const target = fakeNode();
  assert.equal(
    render({ target, payload: { notes: [], characters: [], facts: null } }),
    false
  );
  assert.equal(
    render({
      target,
      payload: {
        characters: [{ name: 'x'.repeat(81) }],
        notes: [],
        facts: []
      }
    }),
    false
  );
  assert.equal(target.hidden, true);
});

test('empty owner Bible sources display explicit no-data states', () => {
  const target = fakeNode();
  const ok = render({
    target,
    payload: { characters: [], notes: [], facts: [] }
  });
  assert.equal(ok, true);
  assert.equal(target.hidden, false);
  assert.match(target.textContent, /【登場人物】\n・まだ登録/);
  assert.match(target.textContent, /【創作ノート（非公開）】\n・まだ登録/);
  assert.match(target.textContent, /【確認候補】\n・確認候補はありません/);
  assert.match(target.textContent, /AIによる自動抽出は未実施/);
});

test('populated owner Bible omits empty-state markers', () => {
  const target = fakeNode();
  const ok = render({
    target,
    payload: {
      characters: [{ name: '主人公' }],
      notes: [{ title: '世界観', body: '作者のみの設定' }],
      facts: [{ kind: 'world', key: '世界設定' }]
    }
  });
  assert.equal(ok, true);
  assert.match(target.textContent, /主人公/);
  assert.match(target.textContent, /作者のみの設定/);
  assert.match(target.textContent, /世界設定/);
  assert.doesNotMatch(target.textContent, /まだ登録されていません|確認候補はありません/);
});
