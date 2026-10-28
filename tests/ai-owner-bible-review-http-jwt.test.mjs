// Local HTTP transport test with signed SYNTHETIC JWTs and a fake Auth verifier.
// This is NOT a hosted Supabase JWT verification or a Staging write test.
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

import { createOwnerBibleReviewApiHandler } from '../api/ai-owner-bible-review.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = 'local-test-only-do-not-use-in-any-environment';
const TITLE = 'Fictional chapter';
const CONTENT = 'An imaginary blue key was found at the harbor.';
const SOURCE_HASH = createHash('sha256')
  .update(JSON.stringify([TITLE, CONTENT]))
  .digest('hex');
const ENV = {
  NOVELIGHT_AI_REVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'local-test-only-service-key',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only'
};

function sign(sub, expiry = Math.floor(Date.now() / 1000) + 90) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp: expiry }))
    .toString('base64url');
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', KEY)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function checkSyntheticToken(token) {
  try {
    const pieces = token.split('.');
    if (pieces.length !== 3) return null;
    const signed = `${pieces[0]}.${pieces[1]}`;
    const actual = Buffer.from(pieces[2], 'base64url');
    const expected = createHmac('sha256', KEY).update(signed).digest();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }
    const claims = JSON.parse(Buffer.from(pieces[1], 'base64url'));
    return typeof claims.sub === 'string' &&
      typeof claims.exp === 'number' &&
      claims.exp > Date.now() / 1000
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

function createFixture() {
  const activity = { clients: 0, auth: 0, reads: 0, decisions: 0 };
  const service = {
    auth: {
      async getUser(token) {
        activity.auth += 1;
        const sub = checkSyntheticToken(token);
        return sub
          ? { data: { user: { id: sub } }, error: null }
          : { data: { user: null }, error: { code: 'invalid_token' } };
      }
    },
    from(table) {
      return {
        select() {
          return {
            eq(field, value) {
              return {
                async maybeSingle() {
                  activity.reads += 1;
                  if (table === 'novels' && field === 'id' && value === 354) {
                    return { data: { id: 354, user_id: OWNER }, error: null };
                  }
                  if (table === 'episodes' && field === 'id' && value === 41) {
                    return {
                      data: {
                        id: 41,
                        novel_id: 354,
                        title: TITLE,
                        content: CONTENT
                      },
                      error: null
                    };
                  }
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const handler = createOwnerBibleReviewApiHandler({
    env: ENV,
    createServiceClient() {
      activity.clients += 1;
      return service;
    },
    createAuthorClient() {
      return { rpc() {} };
    },
    createRepository() {
      return {
        async listPending() {
          return [];
        },
        async listAuthorConfirmed() {
          return [];
        },
        async savePendingBatch() {
          throw new Error('synthetic HTTP test never stages candidates');
        },
        async readCandidate() {
          return {
            id: 7,
            actorId: OWNER,
            novelId: 354,
            sourceEpisodeId: 41,
            sourceHash: SOURCE_HASH,
            factKind: 'character',
            factKey: 'Imaginary hero',
            summary: 'Finds a key at the harbor',
            evidence: 'blue key',
            provenance: 'ai_inferred',
            status: 'pending',
            revision: 1
          };
        },
        async compareAndSwapDecision() {
          activity.decisions += 1;
          return { status: 'accepted', revision: 2 };
        }
      };
    }
  });
  return { handler, activity };
}

async function withLocalApi(handler, run) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let body;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
    }
    const reply = {
      setHeader(name, value) {
        res.setHeader(name, value);
      },
      status(statusCode) {
        res.statusCode = statusCode;
        return this;
      },
      json(payload) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
        return this;
      }
    };
    await handler(
      {
        method: req.method,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
        body
      },
      reply
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function request(base, jwt, opts = {}) {
  const { method = 'GET', origin, body, headers = {} } = opts;
  const response = await fetch(base + '/api/ai-owner-bible-review?novel_id=354', {
    method,
    headers: {
      'x-forwarded-host': 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...(origin ? { origin } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json(), response };
}

test('local HTTP: default OFF returns 404 before client construction', async () => {
  let clients = 0;
  const handle = createOwnerBibleReviewApiHandler({
    env: { ...ENV, NOVELIGHT_AI_REVIEW_ENABLED: 'false' },
    createServiceClient() {
      clients += 1;
    }
  });
  await withLocalApi(handle, async (base) => {
    const result = await request(base, sign(OWNER));
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'NOT_FOUND' });
    assert.equal(result.response.headers.get('cache-control'),
      'private, no-store, max-age=0');
  });
  assert.equal(clients, 0);
});

test('local HTTP: signed synthetic JWTs enforce owner and route boundary', async () => {
  const { handler, activity } = createFixture();
  const valid = sign(OWNER);
  const wrong = sign(OTHER);
  const expired = sign(OWNER, 1);
  const forged = `${valid.slice(0, -5)}xxxxx`;

  await withLocalApi(handler, async (base) => {
    for (const candidate of [wrong, expired, forged]) {
      const denied = await request(base, candidate);
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: 'NOT_FOUND' });
    }
    assert.equal(activity.reads, 0);
    const missing = await request(base, null);
    assert.equal(missing.status, 401);
    assert.equal(activity.auth, 3);

    const crossOrigin = await request(base, valid, {
      origin: 'https://other.example'
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(activity.auth, 3);

    const listed = await request(base, valid);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body, {
      novelId: 354,
      candidates: [],
      aiGenerated: false
    });
    assert.equal(activity.reads, 1);

    const accepted = await request(base, valid, {
      method: 'POST',
      origin: 'https://novelight.jp',
      headers: {
        'content-type': 'application/json',
        'x-novelight-review': '1'
      },
      body: { candidateId: 7, expectedRevision: 1, action: 'accept' }
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, {
      candidateId: 7,
      novelId: 354,
      status: 'accepted',
      revision: 2,
      canonModified: false
    });
  });
  assert.equal(activity.decisions, 1);
});
