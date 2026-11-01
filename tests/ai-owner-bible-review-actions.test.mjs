import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-review-actions.js';

const { attach } = globalThis.NovelightAiBibleReviewActions;
const OWNER = '11111111-1111-4111-8111-111111111111';

function element(tag) {
  return {
    tag,
    textContent: '',
    children: [],
    removed: false,
    listeners: {},
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    remove() {
      this.removed = true;
    }
  };
}

function mock({
  userId = OWNER,
  allow = true,
  postStatus = 200,
  postPayload = null,
  postThrows = false
} = {}) {
  const host = element('main');
  let listener;
  const requests = [];
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              user: { id: userId },
              access_token: 'offline-token'
            }
          }
        };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  async function fetcher(_url, options) {
    requests.push(options);
    if (!allow) return { ok: false };
    if (options.method === 'POST') {
      if (postThrows) throw new Error('offline POST failure');
      return {
        ok: postStatus === 200,
        async json() {
          return postPayload ?? {
            novelId: 354,
            candidateId: 7,
            status: 'accepted',
            revision: 2,
            canonModified: false
          };
        }
      };
    }
    return {
      ok: true,
      async json() {
        return {
          novelId: 354,
          candidates: [
            {
              id: 7,
              episodeId: 4,
              revision: 1,
              kind: 'character',
              key: '<script>架空</script>',
              summary: '青い鍵を持っている。',
              evidence: '凛は青い鍵を持っていた。',
              status: 'pending'
            }
          ]
        };
      }
    };
  }
  return {
    host,
    client,
    fetcher,
    requests,
    doc: {
      getElementById(id) {
        assert.equal(id, 'main-content');
        return host;
      },
      createElement: element
    },
    logout() {
      listener?.('SIGNED_OUT', null);
    }
  };
}

test('review controls do not mount or send requests for another user', async () => {
  const f = mock({ userId: 'other' });
  assert.equal(
    await attach({
      client: f.client,
      novelId: '354',
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    false
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.host.children.length, 0);
});

test('denied API response never reveals a review control', async () => {
  const f = mock({ allow: false });
  assert.equal(
    await attach({
      client: f.client,
      novelId: '354',
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    false
  );
  assert.equal(f.host.children.length, 0);
});

test('private candidates use textContent and require explicit click', async () => {
  const f = mock();
  assert.equal(
    await attach({
      client: f.client,
      novelId: 354,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    true
  );
  assert.equal(f.requests.length, 1);
  const section = f.host.children[0];
  const row = section.children[1].children[0];
  assert.match(row.children[0].textContent, /<script>架空<\/script>/);
  assert.equal(row.children[1].tag, 'button');
  assert.equal(row.children[2].tag, 'button');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].cache, 'no-store');

  // No POST until the author explicitly clicks.
  await row.children[1].listeners.click();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].method, 'POST');
  assert.equal(f.requests[1].headers['X-Novelight-Review'], '1');
  assert.deepEqual(JSON.parse(f.requests[1].body), {
    candidateId: 7,
    expectedRevision: 1,
    action: 'accept'
  });
  assert.equal(row.removed, true);
  f.logout();
  assert.equal(section.removed, true);
});

test('logout clears and removes private candidates', async () => {
  const f = mock();
  await attach({
    client: f.client,
    novelId: '354',
    ownerId: OWNER,
    doc: f.doc,
    fetcher: f.fetcher
  });
  const section = f.host.children[0];
  const list = section.children[1];
  assert.equal(list.children.length, 1);
  f.logout();
  assert.equal(section.removed, true);
  assert.equal(list.textContent, '');
});

test('failed POST cannot be mistaken for accepted review or trigger retries', async () => {
  const f = mock({ postStatus: 503 });
  assert.equal(
    await attach({ client: f.client, novelId: 354, ownerId: OWNER, doc: f.doc, fetcher: f.fetcher }),
    true
  );
  const section = f.host.children[0];
  const list = section.children[1];
  const row = list.children[0];
  await row.children[1].listeners.click();
  assert.equal(f.requests.filter((req) => req.method === 'POST').length, 1);
  assert.equal(row.removed, false);
  assert.equal(section.removed, false);
  assert.equal(
    list.textContent,
    '採用結果を確認できませんでした。ページを再読み込みしてください。'
  );
  await row.children[1].listeners.click();
  assert.equal(f.requests.filter((req) => req.method === 'POST').length, 1);
  f.logout();
  assert.equal(section.removed, true);
  assert.equal(list.textContent, '');
});

test('invalid decision receipt or network failure never reports acceptance', async () => {
  for (const options of [
    { postPayload: { novelId: 354, candidateId: 7, status: 'accepted', revision: 1, canonModified: false } },
    { postThrows: true }
  ]) {
    const f = mock(options);
    await attach({ client: f.client, novelId: 354, ownerId: OWNER, doc: f.doc, fetcher: f.fetcher });
    const list = f.host.children[0].children[1];
    const row = list.children[0];
    await row.children[1].listeners.click();
    assert.equal(row.removed, false);
    assert.equal(
      list.textContent,
      '採用結果を確認できませんでした。ページを再読み込みしてください。'
    );
    assert.equal(f.requests.filter((req) => req.method === 'POST').length, 1);
  }
});
