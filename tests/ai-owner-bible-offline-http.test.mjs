import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import '../novelight-ai-bible-owner-outline-offline-http.js';

const { createReader } = globalThis.NovelightAiBibleOwnerOutlineOfflineHttp;
const PREVIEW = Object.freeze({ novelId: 14, aiGenerated: false });
const TOKEN = 'synthetic-owner-token-not-live';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ROWS = Object.freeze([
  {
    episode_id: 100,
    episode_number: 3,
    chapter_id: 8,
    chapter_title: '第一章',
    chapter_position: 1
  }
]);

function fakeClient() {
  const state = { token: TOKEN, owner: OWNER, reads: 0 };
  return {
    state,
    auth: {
      async getSession() {
        state.reads += 1;
        return {
          data: {
            session: state.token
              ? { user: { id: state.owner }, access_token: state.token }
              : null
          },
          error: null
        };
      }
    }
  };
}

test('default-off reader performs no session read and no HTTP transport', async () => {
  const client = fakeClient();
  let requests = 0;
  const fetcher = async () => {
    requests += 1;
    throw Error('SHOULD_NOT_RUN');
  };
  assert.equal(
    await createReader({ client, fetcher })({ novelId: 14, preview: PREVIEW }),
    null
  );
  assert.equal(
    await createReader({ enabled: true, client })({
      novelId: 14,
      preview: PREVIEW
    }),
    null
  );
  assert.equal(
    await createReader({ enabled: true, client, fetcher })({
      novelId: '14other',
      preview: PREVIEW
    }),
    null
  );
  assert.equal(
    await createReader({ enabled: true, client, fetcher })({
      novelId: 14,
      preview: { ...PREVIEW, novelId: 15 }
    }),
    null
  );
  assert.equal(client.state.reads, 0);
  assert.equal(requests, 0);
});

test('explicitly injected HTTP reader uses scoped GET and outputs only rows', async () => {
  const client = fakeClient();
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/ai-owner-bible-outline?novel_id=14');
    assert.deepEqual(options, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + TOKEN },
      cache: 'no-store',
      credentials: 'same-origin'
    });
    return {
      ok: true,
      async json() {
        return { novelId: 14, aiGenerated: false, outlineRows: ROWS };
      }
    };
  };
  const rows = await createReader({
    enabled: true,
    client,
    fetcher
  })({ novelId: '14', preview: PREVIEW });
  assert.deepEqual(rows, ROWS);
  assert.equal(client.state.reads, 2);
});

test('wrong novel, unexpected/private fields, malformed response or server denial fail closed', async () => {
  const bodies = [
    { novelId: 15, aiGenerated: false, outlineRows: ROWS },
    { novelId: 14, aiGenerated: true, outlineRows: ROWS },
    { novelId: 14, aiGenerated: false, candidates: [], outlineRows: ROWS },
    {
      novelId: 14,
      aiGenerated: false,
      outlineRows: [{ ...ROWS[0], episode_title: 'SECRET_UNPUBLISHED' }]
    },
    {
      novelId: 14,
      aiGenerated: false,
      outlineRows: [{ ...ROWS[0], episode_status: 'draft' }]
    },
    { novelId: 14, aiGenerated: false, outlineRows: null },
    {
      novelId: 14,
      aiGenerated: false,
      outlineRows: [{ ...ROWS[0], chapter_title: null }]
    },
    {
      novelId: 14,
      aiGenerated: false,
      outlineRows: [{ ...ROWS[0], chapter_id: null }]
    },
    null
  ];
  for (const body of bodies) {
    const client = fakeClient();
    const rows = await createReader({
      enabled: true,
      client,
      async fetcher() {
        return {
          ok: true,
          async json() {
            return body;
          }
        };
      }
    })({ novelId: 14, preview: PREVIEW });
    assert.equal(rows, null);
  }
  const client = fakeClient();
  const denied = await createReader({
    enabled: true,
    client,
    async fetcher() {
      return { ok: false, status: 403 };
    }
  })({ novelId: 14, preview: PREVIEW });
  assert.equal(denied, null);
});

test('logout or account/token change during transport never returns stale private rows', async () => {
  for (const mode of ['logout', 'switch', 'rotate']) {
    const client = fakeClient();
    const read = createReader({
      enabled: true,
      client,
      async fetcher() {
        if (mode === 'logout') client.state.token = null;
        if (mode === 'switch') client.state.owner = 'other-user';
        if (mode === 'rotate') client.state.token = TOKEN + '_new';
        return {
          ok: true,
          async json() {
            return { novelId: 14, aiGenerated: false, outlineRows: ROWS };
          }
        };
      }
    });
    assert.equal(await read({ novelId: 14, preview: PREVIEW }), null);
    assert.equal(client.state.reads, 2);
  }
});

test('new HTTP adapter is an unmounted offline-only script', () => {
  const page = readFileSync(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  const studio = readFileSync(
    new URL('../novelight-ai-bible-owner-studio.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(page, /owner-outline-offline-http|readOutline\s*:/);
  assert.doesNotMatch(studio, /owner-outline-offline-http/);
});
