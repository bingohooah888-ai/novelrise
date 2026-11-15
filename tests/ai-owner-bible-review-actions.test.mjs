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
  getPayload = null,
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
          if (postPayload !== null) return postPayload;
          return {
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
        return (
          getPayload ?? {
            novelId: 354,
            aiGenerated: false,
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
          }
        );
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
  assert.match(row.children[0].textContent, /参照エピソードID：4/);
  assert.doesNotMatch(row.children[0].textContent, /第4話/);
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
    await attach({
      client: f.client,
      novelId: 354,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher
    }),
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
    {
      postPayload: {
        novelId: 354,
        candidateId: 7,
        status: 'accepted',
        revision: 1,
        canonModified: false
      }
    },
    { postThrows: true }
  ]) {
    const f = mock(options);
    await attach({
      client: f.client,
      novelId: 354,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher
    });
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

test('malformed or cross-work review GET responses never mount author actions or issue POST', async () => {
  const candidate = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'event',
    key: '出発',
    summary: '物語が始まる',
    evidence: '最初の一歩を踏み出した',
    status: 'pending'
  };
  const root = { novelId: 354, aiGenerated: false, candidates: [candidate] };
  const bad = [
    { ...root, novelId: 355 },
    { ...root, aiGenerated: true },
    { ...root, aiGenerated: undefined },
    { ...root, characters: [], notes: [], facts: [], candidates: undefined },
    { ...root, candidates: [candidate, { ...candidate }] },
    { ...root, candidates: [{ ...candidate, kind: '__proto__' }] },
    { ...root, candidates: [{ ...candidate, status: 'accepted' }] },
    { ...root, candidates: [{ ...candidate, summary: '' }] },
    { ...root, candidates: [{ ...candidate, evidence: '' }] }
  ];
  for (const body of bad) {
    const f = mock({ getPayload: body });
    assert.equal(
      await attach({
        client: f.client,
        novelId: 354,
        ownerId: OWNER,
        doc: f.doc,
        fetcher: f.fetcher
      }),
      false
    );
    assert.equal(f.host.children.length, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, 'GET');
  }
});

test('stale pending and accepted candidates are visibly segregated with no actions', async () => {
  const stalePending = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'character',
    key: '凛',
    summary: '改稿前の未確認候補',
    evidence: '青い鍵',
    status: 'pending',
    staleReason: 'source_changed'
  };
  const staleAccepted = {
    ...stalePending,
    id: 8,
    revision: 2,
    status: 'accepted',
    summary: '改稿前の確認済み候補',
    staleReason: 'episode_missing'
  };
  let transferred = 0;
  const f = mock({
    getPayload: {
      novelId: 354,
      aiGenerated: false,
      candidates: [],
      acceptedCandidates: [],
      staleCandidates: [stalePending, staleAccepted]
    }
  });
  assert.equal(
    await attach({
      client: f.client,
      novelId: 354,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher,
      onAccepted: async () => {
        transferred += 1;
        return true;
      }
    }),
    true
  );
  const section = f.host.children[0];
  const list = section.children[1];
  const rows = list.children.filter((item) => item.tag === 'div');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.children.length, 1);
    assert.equal(row.children[0].tag, 'p');
  }
  assert.match(rows[0].children[0].textContent, /旧版の候補/u);
  assert.match(rows[1].children[0].textContent, /過去に確認済み/u);
  assert.match(rows[1].children[0].textContent, /参照話が見つかりません/u);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(transferred, 0);
  f.logout();
  assert.equal(section.removed, true);
});

test('stale payload cannot forge current accept or notes-transfer controls', async () => {
  const current = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'event',
    key: '出発',
    summary: '本文中の旅立ち',
    evidence: '扉を開いた',
    status: 'pending'
  };
  const stale = {
    ...current,
    id: 8,
    staleReason: 'source_changed'
  };
  const root = {
    novelId: 354,
    aiGenerated: false,
    candidates: [current],
    acceptedCandidates: []
  };
  const malformed = [
    { ...root, staleCandidates: [current] },
    { ...root, staleCandidates: [{ ...stale, staleReason: 'unknown' }] },
    { ...root, staleCandidates: [{ ...stale, status: 'rejected' }] },
    { ...root, staleCandidates: [{ ...stale, revision: 0 }] },
    { ...root, staleCandidates: [{ ...stale, id: 7 }] },
    { ...root, staleCandidates: Array.from({ length: 201 }, () => stale) },
    { ...root, staleCandidates: { ...stale } }
  ];
  for (const payload of malformed) {
    const f = mock({ getPayload: payload });
    assert.equal(
      await attach({
        client: f.client,
        novelId: 354,
        ownerId: OWNER,
        doc: f.doc,
        fetcher: f.fetcher
      }),
      false
    );
    assert.equal(f.host.children.length, 0);
    assert.equal(f.requests.length, 1);
  }
});
