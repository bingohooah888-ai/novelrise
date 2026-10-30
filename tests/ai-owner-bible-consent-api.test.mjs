import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleConsentApiHandler } from '../api/ai-owner-bible-consent.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'offline-synthetic-owner-auth-bearer';
const REVISION = 'novel-bible-2026-10-30-v1';
const env = {
  NOVELIGHT_AI_CONSENT_UI_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_offline_public_key',
  SUPABASE_SECRET_KEY: 'offline-secret-not-a-real-key'
};
const headers = {
  host: 'novelight.jp',
  'sec-fetch-site': 'same-origin',
  authorization: 'Bearer ' + TOKEN
};
const postHeaders = {
  ...headers,
  origin: 'https://novelight.jp',
  'content-type': 'application/json',
  'x-novelight-ai-consent': '1'
};

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function view() {
  return {
    novelId: 41,
    policyRevision: REVISION,
    aiEnabled: false,
    disclosures: [
      {
        processor: 'openai',
        label: 'OpenAI（模擬表示）',
        purpose: '作品カルテの人物・設定の候補抽出',
        dataSent: '選んだエピソードの必要な本文断片のみ',
        retention: '検証用・現時点では送信されません',
        internationalTransfer: '試用前に正式な条件を確認します',
        status: 'none',
        expiresAt: null
      }
    ]
  };
}

function fixture({
  actor = OWNER,
  actualEnv = env,
  withRuntime = true,
  invalidView = false,
  failAuth = false
} = {}) {
  const calls = { clients: 0, runtime: 0, reads: 0, grants: 0, revokes: 0 };
  const handle = createOwnerBibleConsentApiHandler({
    env: actualEnv,
    createServiceClient(url, key) {
      calls.clients += 1;
      assert.equal(url, env.SUPABASE_URL);
      assert.equal(key, env.SUPABASE_SECRET_KEY);
      return {
        auth: {
          async getUser(token) {
            assert.equal(token, TOKEN);
            return {
              data: { user: { id: actor } },
              error: failAuth ? { message: 'offline error' } : null
            };
          }
        }
      };
    },
    createConsentRuntime: withRuntime
      ? ({ ownerId }) => {
          calls.runtime += 1;
          assert.equal(ownerId, OWNER);
          return {
            async read({ token, novelId }) {
              calls.reads += 1;
              assert.equal(token, TOKEN);
              assert.equal(novelId, 41);
              return invalidView
                ? { ...view(), disclosures: [] }
                : { ...view(), privateManuscript: 'never return me' };
            },
            async grant(params) {
              calls.grants += 1;
              assert.equal(params.explicitAuthorAction, true);
              assert.equal(params.acceptedExternalProcessing, true);
              assert.equal(params.acceptedDisclosureRevision, REVISION);
              assert.equal(params.token, TOKEN);
              return {
                novelId: 41,
                processor: 'openai',
                policyRevision: REVISION,
                status: 'granted',
                expiresAt: '2026-11-29T10:00:00Z',
                aiEnabled: false
              };
            },
            async revoke(params) {
              calls.revokes += 1;
              assert.equal(params.explicitAuthorAction, true);
              assert.equal(params.token, TOKEN);
              return {
                novelId: 41,
                processor: 'openai',
                status: 'revoked',
                aiEnabled: false
              };
            }
          };
        }
      : null
  });
  const request = (updates = {}) => ({
    method: 'GET',
    headers,
    query: { novel_id: '41' },
    ...updates
  });
  return { handle, request, calls };
}

test('route is 404 by default with no privileged client construction', async () => {
  const f = fixture({ actualEnv: {} });
  const res = response();
  await f.handle(f.request(), res);
  assert.equal(res.statusCode, 404);
  assert.equal(f.calls.clients, 0);
  assert.equal(f.calls.runtime, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('configuration flags alone cannot activate an unbound consent runtime', async () => {
  const f = fixture({ withRuntime: false });
  const res = response();
  await f.handle(f.request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(f.calls.clients, 0);
});

test('wrong methods, cross-origin and no owner bearer fail before clients', async () => {
  const f = fixture();
  for (const [change, expected] of [
    [{ method: 'PUT' }, 405],
    [{ headers: { ...headers, origin: 'https://evil.invalid' } }, 403],
    [{ headers: { ...headers, authorization: undefined } }, 401],
    [{ query: { novel_id: '0' } }, 400]
  ]) {
    const res = response();
    await f.handle(f.request(change), res);
    assert.equal(res.statusCode, expected);
  }
  assert.equal(f.calls.clients, 0);
});

test('GET verifies server owner and projects only consent disclosures', async () => {
  const f = fixture();
  const res = response();
  await f.handle(f.request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.calls.reads, 1);
  assert.equal(res.body.aiEnabled, false);
  assert.equal(res.body.privateManuscript, undefined);
  assert.equal(res.body.disclosures[0].status, 'none');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('another actor, invalid Auth or incomplete disclosure is rejected', async () => {
  for (const inputs of [
    { actor: OTHER },
    { failAuth: true },
    { invalidView: true }
  ]) {
    const f = fixture(inputs);
    const res = response();
    await f.handle(f.request(), res);
    assert.ok([401, 404, 503].includes(res.statusCode));
    assert.equal(f.calls.grants, 0);
  }
});

test('POST demands real same-origin, JSON and custom consent header', async () => {
  const f = fixture();
  for (const h of [
    headers,
    { ...postHeaders, origin: 'https://evil.invalid' },
    { ...postHeaders, 'x-novelight-ai-consent': undefined },
    { ...postHeaders, 'content-type': 'text/plain' }
  ]) {
    const res = response();
    await f.handle(
      f.request({
        method: 'POST',
        headers: h,
        body: {
          action: 'revoke',
          processor: 'openai'
        }
      }),
      res
    );
    assert.equal(res.statusCode, 403);
  }
  assert.equal(f.calls.clients, 0);
});

test('unknown, stale and extra-field POSTs never reach the RPC adapter', async () => {
  const f = fixture();
  for (const body of [
    { action: 'grant', processor: 'openai' },
    { action: 'grant', processor: 'openai', policyRevision: REVISION,
      acceptedExternalProcessing: false },
    { action: 'grant', processor: 'gemini', policyRevision: 'x',
      acceptedExternalProcessing: true },
    { action: 'revoke', processor: 'openai', acceptedExternalProcessing: true },
    { action: 'delete', processor: 'openai' },
    { action: 'revoke', processor: 'unapproved' }
  ]) {
    const res = response();
    await f.handle(
      f.request({ method: 'POST', headers: postHeaders, body }),
      res
    );
    assert.equal(res.statusCode, 400);
  }
  assert.equal(f.calls.clients, 0);
});

test('POST grant and revoke are explicit, owner-scoped and never run AI', async () => {
  const f = fixture();
  const grantRes = response();
  await f.handle(
    f.request({
      method: 'POST',
      headers: postHeaders,
      body: {
        action: 'grant',
        processor: 'openai',
        policyRevision: REVISION,
        acceptedExternalProcessing: true
      }
    }),
    grantRes
  );
  assert.equal(grantRes.statusCode, 200);
  assert.deepEqual(grantRes.body, {
    novelId: 41,
    processor: 'openai',
    status: 'granted',
    aiEnabled: false,
    policyRevision: REVISION,
    expiresAt: '2026-11-29T10:00:00Z'
  });

  const revokeRes = response();
  await f.handle(
    f.request({
      method: 'POST',
      headers: postHeaders,
      body: { action: 'revoke', processor: 'openai' }
    }),
    revokeRes
  );
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.body.status, 'revoked');
  assert.equal(f.calls.grants, 1);
  assert.equal(f.calls.revokes, 1);
  assert.equal(f.calls.reads, 0);
});
