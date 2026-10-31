import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleAnalyzeApiHandler } from '../api/ai-owner-bible-analyze.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-bearer-only';
// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_REVIEW_ENABLED: 'true',
  NOVELIGHT_AI_MODEL_TRIAL_ENABLED: 'true',
  NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED: 'true',
  NOVELIGHT_AI_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED: 'true',
  NOVELIGHT_AI_CONSENT_POLICY_REVISION: 'synthetic-20261031',
  NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
    {
      processor: 'openai',
      label: '架空の処理事業者',
      purpose: '合成データの検証',
      dataSent: '合成テキストのみ',
      retention: '通信しない',
      internationalTransfer: '通信しない'
    }
  ]),
  NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID: '41',
  NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID: '11',
  NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([
    { provider: 'openai', model: 'synthetic-model' }
  ]),
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_public_key',
  SUPABASE_SECRET_KEY: 'synthetic-service-key'
};

// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
function fixture({
  actor = OWNER,
  consent = true,
  budget = true,
  flags = {},
  ownerWork = OWNER
} = {}) {
  const calls = { auth: 0, model: 0, reserve: 0, data: [] };
  const data = {
    from(table) {
      calls.data.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        async maybeSingle() {
          if (table === 'novels') {
            return { data: { id: 41, user_id: ownerWork }, error: null };
          }
          if (table === 'episodes') {
            return { data: { id: 11, novel_id: 41 }, error: null };
          }
          if (table === 'novelight_ai_runtime_settings') {
            return {
              data: {
                enabled: budget,
                user_day_cap_micros: budget ? 1000000 : 0,
                user_month_cap_micros: budget ? 1000000 : 0,
                global_day_cap_micros: budget ? 1000000 : 0,
                global_month_cap_micros: budget ? 1000000 : 0
              },
              error: null
            };
          }
          throw new Error('Unexpected table');
        },
        async limit() {
          if (table !== 'novelight_ai_external_processing_consents') {
            throw new Error('Unexpected list');
          }
          return {
            data: consent
              ? [
                  {
                    processor: 'openai',
                    policy_revision: 'synthetic-20261031',
                    granted_at: new Date(Date.now() - 1000).toISOString(),
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    revoked_at: null
                  }
                ]
              : [],
            error: null
          };
        }
      };
    },
    auth: {
      async getUser(value) {
        assert.equal(value, TOKEN);
        calls.auth += 1;
        return { data: { user: { id: actor } }, error: null };
      }
    }
  };
  const handler = createOwnerBibleAnalyzeApiHandler({
    env: { ...ENV, ...flags },
    createServiceClient() {
      return data;
    },
    createTrialBridge() {
      calls.model += 1;
      return { stage() { calls.reserve += 1; } };
    }
  });
  const request = {
    method: 'GET',
    query: { novel_id: '41' },
    headers: {
      authorization: 'Bearer ' + TOKEN,
      host: 'novelight.jp',
      origin: 'https://novelight.jp',
      'sec-fetch-site': 'same-origin',
      'x-novelight-ai-trial-status': '1'
    }
  };
  const response = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; }
  };
  return {
    calls,
    request,
    response,
    async call(changes = {}) {
      await handler({ ...request, ...changes }, response);
      return response;
    }
  };
}

// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
test('owner readiness GET validates consent and caps without a model call', async () => {
  const f = fixture();
  const result = await f.call();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    trialReady: true,
    novelId: 41,
    episodeId: 11,
    chunkIndex: 0
  });
  assert.equal(f.calls.model, 0);
  assert.equal(f.calls.reserve, 0);
  assert.ok(f.calls.data.includes('novelight_ai_runtime_settings'));
  assert.ok(!JSON.stringify(result.body).includes(TOKEN));
});

// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
test('GET requires explicit readiness header and known work', async () => {
  const noHeader = fixture();
  assert.equal(
    (await noHeader.call({
      headers: { ...noHeader.request.headers, 'x-novelight-ai-trial-status': undefined }
    })).statusCode,
    405
  );
  assert.equal(noHeader.calls.auth, 0);
  const otherWork = fixture();
  assert.equal(
    (await otherWork.call({ query: { novel_id: '42' } })).statusCode,
    404
  );
  assert.equal(otherWork.calls.model, 0);
});

// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
test('no consent, expired policy or disabled budget hides readiness', async () => {
  for (const f of [
    fixture({ consent: false }),
    fixture({ budget: false }),
    fixture({ ownerWork: OTHER }),
    fixture({ flags: { NOVELIGHT_AI_CONSENT_POLICY_REVISION: '' } })
  ]) {
    const result = await f.call();
    assert.equal(result.statusCode, 404);
    assert.equal(f.calls.model, 0);
    assert.equal(f.calls.reserve, 0);
  }
});

// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
test('missing server flag, other actor, absent bearer and cross-origin deny', async () => {
  const off = fixture({ flags: { NOVELIGHT_AI_ENABLED: 'false' } });
  assert.equal((await off.call()).statusCode, 404);
  assert.equal(off.calls.auth, 0);
  const other = fixture({ actor: OTHER });
  assert.equal((await other.call()).statusCode, 404);
  const noBearer = fixture();
  assert.equal(
    (await noBearer.call({
      headers: { ...noBearer.request.headers, authorization: undefined }
    })).statusCode,
    401
  );
  const crossOrigin = fixture();
  assert.equal(
    (await crossOrigin.call({
      headers: { ...crossOrigin.request.headers, origin: 'https://example.net' }
    })).statusCode,
    403
  );
});
