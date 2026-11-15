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
  postThrows = false,
  transferPayload = null,
  transferStatus = 200,
  transferThrows = false
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
    if (_url.includes('&transfer_candidate_id=')) {
      if (transferThrows) throw new Error('offline transfer failure');
      return {
        ok: transferStatus === 200,
        async json() {
          return transferPayload;
        }
      };
    }
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

test('same-kind/key revised proposal can be reviewed while old version stays read-only', async () => {
  const current = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'character',
    key: '凛',
    summary: '改稿後の本文に基づく候補',
    evidence: '凛は新しい扉を開いた。',
    status: 'pending',
    replacesOutdatedVersion: true
  };
  const historical = {
    id: 8,
    episodeId: 4,
    revision: 2,
    kind: 'character',
    key: '凛',
    summary: '改稿前の内容',
    evidence: '凛は青い鍵を持っていた。',
    status: 'accepted',
    staleReason: 'source_changed'
  };
  let transfers = 0;
  const f = mock({
    getPayload: {
      novelId: 354,
      aiGenerated: false,
      candidates: [current],
      acceptedCandidates: [],
      staleCandidates: [historical]
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
        transfers += 1;
        return true;
      }
    }),
    true
  );
  const list = f.host.children[0].children[1];
  const newRow = list.children[0];
  assert.match(newRow.children[0].textContent, /改稿後の新版候補/u);
  assert.match(newRow.children[0].textContent, /凛/u);
  assert.equal(newRow.children[1].tag, 'button');
  assert.equal(newRow.children[2].tag, 'button');
  const oldRow = list.children[list.children.length - 1];
  assert.equal(oldRow.children.length, 1);
  assert.equal(oldRow.children[0].tag, 'p');
  assert.match(oldRow.children[0].textContent, /旧版の候補/u);
  assert.match(oldRow.children[0].textContent, /凛/u);
  assert.equal(f.requests.filter((req) => req.method === 'POST').length, 0);
  await newRow.children[1].listeners.click();
  assert.deepEqual(JSON.parse(f.requests[1].body), {
    candidateId: 7,
    expectedRevision: 1,
    action: 'accept'
  });
  assert.equal(newRow.removed, true);
  assert.equal(oldRow.removed, false);
  assert.equal(transfers, 0);
});

test('invalid new-version label from API never exposes review controls', async () => {
  const candidate = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'event',
    key: '開始',
    summary: '話の始まり',
    evidence: '扉が開いた。',
    status: 'pending'
  };
  for (const value of [false, 'true', 1, null]) {
    const f = mock({
      getPayload: {
        novelId: 354,
        aiGenerated: false,
        candidates: [{ ...candidate, replacesOutdatedVersion: value }],
        staleCandidates: []
      }
    });
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
  }
});

test('just-in-time transfer rechecks accepted row before changing note editor', async () => {
  const accepted = {
    id: 7,
    episodeId: 4,
    revision: 2,
    kind: 'world',
    key: '青い王都',
    summary: '青い城壁を持つ。',
    evidence: '王都の城壁は青い。',
    status: 'accepted'
  };
  const f = mock({
    getPayload: {
      novelId: 354,
      aiGenerated: false,
      candidates: [],
      acceptedCandidates: [accepted]
    },
    transferPayload: {
      novelId: 354,
      transferReady: true,
      candidate: accepted
    }
  });
  const drafts = [];
  assert.equal(
    await attach({
      client: f.client,
      novelId: 354,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher,
      onAccepted: async (candidate) => {
        drafts.push(candidate);
        return true;
      }
    }),
    true
  );
  const list = f.host.children[0].children[1];
  const transfer = list.children[1].children[1].children[0];
  assert.equal(f.requests.length, 1);
  await transfer.listeners.click();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].method, 'GET');
  assert.equal(f.requests[1].cache, 'no-store');
  assert.equal(f.requests[1].headers.Authorization, 'Bearer offline-token');
  assert.equal(f.requests.filter((req) => req.method === 'POST').length, 0);
  assert.deepEqual(drafts, [
    {
      kind: 'world',
      key: '青い王都',
      summary: '青い城壁を持つ。',
      evidence: '王都の城壁は青い。',
      episodeId: 4
    }
  ]);
  assert.equal(list.children[1].children[1].removed, true);
});

test('edit after listing or denied recheck never transfers an old accepted row', async () => {
  const accepted = {
    id: 7,
    episodeId: 4,
    revision: 2,
    kind: 'world',
    key: '青い王都',
    summary: '青い城壁を持つ。',
    evidence: '王都の城壁は青い。',
    status: 'accepted'
  };
  const list = {
    novelId: 354,
    aiGenerated: false,
    candidates: [],
    acceptedCandidates: [accepted]
  };
  for (const options of [
    { transferStatus: 409 },
    { transferStatus: 404 },
    { transferThrows: true },
    {
      transferPayload: {
        novelId: 354,
        transferReady: false,
        candidate: accepted
      }
    },
    {
      transferPayload: {
        novelId: 354,
        transferReady: true,
        candidate: { ...accepted, revision: 3 }
      }
    },
    {
      transferPayload: {
        novelId: 354,
        transferReady: true,
        candidate: { ...accepted, evidence: '別の本文' }
      }
    }
  ]) {
    const f = mock({ getPayload: list, ...options });
    let transfers = 0;
    assert.equal(
      await attach({
        client: f.client,
        novelId: 354,
        ownerId: OWNER,
        doc: f.doc,
        fetcher: f.fetcher,
        onAccepted: async () => {
          transfers += 1;
          return true;
        }
      }),
      true
    );
    const section = f.host.children[0];
    const transfer = section.children[1].children[1].children[1].children[0];
    await transfer.listeners.click();
    assert.equal(transfers, 0);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests.filter((req) => req.method === 'POST').length, 0);
    assert.match(section.children[2].textContent, /転記できませんでした/u);
    assert.equal(transfer.removed, false);
  }
});

test('newly accepted candidate transfers only after fresh revision-two verification', async () => {
  const pending = {
    id: 7,
    episodeId: 4,
    revision: 1,
    kind: 'character',
    key: '凛',
    summary: '青い鍵を持っている。',
    evidence: '凛は青い鍵を持っていた。',
    status: 'pending'
  };
  const verified = { ...pending, revision: 2, status: 'accepted' };
  const f = mock({
    getPayload: {
      novelId: 354,
      aiGenerated: false,
      candidates: [pending]
    },
    transferPayload: {
      novelId: 354,
      transferReady: true,
      candidate: verified
    }
  });
  let transfers = 0;
  await attach({
    client: f.client,
    novelId: 354,
    ownerId: OWNER,
    doc: f.doc,
    fetcher: f.fetcher,
    onAccepted: async () => {
      transfers += 1;
      return true;
    }
  });
  const list = f.host.children[0].children[1];
  await list.children[0].children[1].listeners.click();
  const transfer = list.children[1].children[0];
  await transfer.listeners.click();
  assert.equal(transfers, 1);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].method, 'GET');
  assert.equal(f.requests.filter((req) => req.method === 'POST').length, 1);
});

test('130 mixed active, accepted and stale candidates load only by explicit older-page clicks', async () => {
  const records = Array.from({ length: 130 }, (_, i) => {
    const id = i + 1;
    const status = id % 4 === 0 ? 'accepted' : 'pending';
    return {
      id,
      episodeId: 4,
      revision: status === 'accepted' ? 2 : 1,
      kind: 'character',
      key: '凛',
      summary: '候補 ' + id,
      evidence: '青い鍵',
      status,
      ...(id % 3 === 0 ? { staleReason: 'source_changed' } : {})
    };
  });
  const urls = [];
  const f = mock();
  const fetcher = async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    urls.push(url);
    const match = url.match(/[?&]before_id=(\d+)/u);
    const before = match ? Number(match[1]) : null;
    const batch = records
      .filter((row) => before === null || row.id < before)
      .sort((a, b) => b.id - a.id);
    const selected = batch.slice(0, 25);
    return {
      ok: true,
      async json() {
        return {
          novelId: 354,
          aiGenerated: false,
          candidates: selected.filter(
            (row) => row.status === 'pending' && !row.staleReason
          ),
          acceptedCandidates: selected.filter(
            (row) => row.status === 'accepted' && !row.staleReason
          ),
          staleCandidates: selected.filter((row) => row.staleReason),
          pagination: {
            nextBeforeId:
              batch.length > 25 ? selected[selected.length - 1].id : null
          }
        };
      }
    };
  };
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 354,
      doc: f.doc,
      fetcher,
      onAccepted: async () => true
    }),
    true
  );
  const section = f.host.children[0];
  const list = section.children[1];
  const next = section.children[3].children[0];
  assert.equal(urls.length, 1);
  assert.equal(list.children.filter((node) => node.tag === 'div').length, 25);
  assert.equal(next.hidden, false);
  for (let i = 0; i < 5; i += 1) {
    await next.listeners.click();
  }
  assert.equal(urls.length, 6);
  assert.deepEqual(
    urls.slice(1).map((url) => Number(url.split('before_id=')[1])),
    [106, 81, 56, 31, 6]
  );
  assert.equal(next.hidden, true);
  assert.equal(list.children.filter((node) => node.tag === 'div').length, 130);
  const historical = list.children.filter(
    (node) =>
      node.tag === 'div' && node.children[0].textContent.includes('旧版の候補')
  );
  assert.equal(historical.length, 43);
  assert.ok(historical.every((node) => node.children.length === 1));
  await next.listeners.click();
  assert.equal(urls.length, 6);
  f.logout();
  assert.equal(section.removed, true);
});

test('duplicate or unscoped next page is refused without exposing more controls', async () => {
  const first = Array.from({ length: 25 }, (_, i) => ({
    id: 50 - i,
    episodeId: 4,
    revision: 1,
    kind: 'event',
    key: '発見',
    summary: '候補 ' + i,
    evidence: '古い巻物',
    status: 'pending'
  }));
  const f = mock();
  let reads = 0;
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 354,
      doc: f.doc,
      fetcher: async () => {
        reads += 1;
        return {
          ok: true,
          async json() {
            return reads === 1
              ? {
                  novelId: 354,
                  aiGenerated: false,
                  candidates: first,
                  pagination: { nextBeforeId: 26 }
                }
              : {
                  novelId: 354,
                  aiGenerated: false,
                  candidates: [first[24]],
                  pagination: { nextBeforeId: null }
                };
          }
        };
      }
    }),
    true
  );
  const section = f.host.children[0];
  const next = section.children[3].children[0];
  await next.listeners.click();
  assert.equal(reads, 2);
  assert.equal(next.hidden, true);
  assert.match(section.children[2].textContent, /続きを確認できませんでした/u);
  assert.equal(
    section.children[1].children.filter((node) => node.tag === 'div').length,
    25
  );
  await next.listeners.click();
  assert.equal(reads, 2);
});

test('cross-page version label persists before matching historical row loads', async () => {
  const pending = Array.from({ length: 25 }, (_, index) => ({
    id: 26 - index,
    episodeId: 41,
    revision: 1,
    kind: 'character',
    key: index === 0 ? '凛' : '別の人物' + index,
    summary: '新しい本文からの候補',
    evidence: '青い鍵',
    status: 'pending',
    ...(index === 0 ? { replacesOutdatedVersion: true } : {})
  }));
  const historical = {
    id: 1,
    episodeId: 41,
    revision: 2,
    kind: 'character',
    key: '凛',
    summary: '古い本文からの候補',
    evidence: '赤い鍵',
    status: 'accepted',
    staleReason: 'source_changed'
  };
  const f = mock();
  let reads = 0;
  const mounted = await attach({
    client: f.client,
    ownerId: OWNER,
    novelId: 354,
    doc: f.doc,
    fetcher: async (_url, options) => {
      assert.equal(options.method, 'GET');
      reads += 1;
      return {
        ok: true,
        async json() {
          return reads === 1
            ? {
                novelId: 354,
                aiGenerated: false,
                candidates: pending,
                pagination: { nextBeforeId: 2 }
              }
            : {
                novelId: 354,
                aiGenerated: false,
                candidates: [],
                staleCandidates: [historical],
                pagination: { nextBeforeId: null }
              };
        }
      };
    }
  });
  assert.equal(mounted, true);
  const section = f.host.children[0];
  const list = section.children[1];
  const current = list.children[0];
  assert.match(current.children[0].textContent, /改稿後の新版候補/u);
  assert.match(current.children[0].textContent, /凛/u);
  assert.equal(current.children[1].tag, 'button');
  assert.equal(reads, 1);
  const next = section.children[3].children[0];
  await next.listeners.click();
  assert.equal(reads, 2);
  assert.equal(next.hidden, true);
  const oldest = list.children[list.children.length - 1];
  assert.match(oldest.children[0].textContent, /旧版の候補/u);
  assert.match(oldest.children[0].textContent, /凛/u);
  assert.equal(oldest.children.length, 1);
  assert.match(current.children[0].textContent, /改稿後の新版候補/u);
});

test('owner refresh replaces only a freshly verified review list without POST', async () => {
  const f = mock();
  const candidate = {
    id: 9,
    episodeId: 4,
    revision: 1,
    status: 'pending',
    kind: 'world',
    key: '地図',
    summary: '古い草案',
    evidence: '古い本文'
  };
  let current = {
    novelId: 354,
    aiGenerated: false,
    candidates: [candidate]
  };
  let reads = 0;
  let allow = true;
  const fetcher = async (_url, options) => {
    assert.equal(options.method, 'GET');
    reads += 1;
    return {
      ok: allow,
      async json() {
        return current;
      }
    };
  };
  const options = {
    client: f.client,
    ownerId: OWNER,
    novelId: 354,
    doc: f.doc,
    fetcher
  };
  assert.equal(await attach(options), true);
  const first = f.host.children[0];
  assert.match(first.children[1].children[0].children[0].textContent, /古い草案/u);
  current = {
    novelId: 354,
    aiGenerated: false,
    candidates: [{ ...candidate, id: 10, summary: '新しい草案' }]
  };
  const { refresh } = globalThis.NovelightAiBibleReviewActions;
  assert.equal(await refresh(options), true);
  const second = f.host.children[1];
  assert.equal(first.removed, true);
  assert.match(second.children[1].children[0].children[0].textContent, /新しい草案/u);
  assert.equal(reads, 2);
  assert.equal(f.requests.length, 0);
  allow = false;
  assert.equal(await refresh(options), false);
  assert.equal(second.removed, true);
  assert.equal(await refresh(options), null);
});

test('cross-account review refresh cannot fetch, replace or mutate a view', async () => {
  const f = mock();
  const options = {
    client: f.client,
    ownerId: OWNER,
    novelId: 354,
    doc: f.doc,
    fetcher: f.fetcher
  };
  assert.equal(await attach(options), true);
  const section = f.host.children[0];
  const { refresh } = globalThis.NovelightAiBibleReviewActions;
  assert.equal(await refresh({ ...options, ownerId: 'other' }), false);
  assert.equal(await refresh({ ...options, novelId: 355 }), false);
  assert.equal(f.requests.length, 1);
  assert.equal(section.removed, false);
  f.logout();
  assert.equal(section.removed, true);
  assert.equal(await refresh(options), null);
});
