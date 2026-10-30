import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleConsentApiHandler } from '../api/ai-owner-bible-consent.js';
import {
  createOwnerNovelBibleConsentRuntime,
  resolveOwnerNovelBibleConsentRuntimePolicy
} from '../api/_lib/ai/owner-novel-bible-consent-runtime.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-private-jwt-for-tests-only';
const REVISION = 'novel-bible-2026-10-30-v1';
const FIXED_NOW = Date.parse('2026-10-30T10:00:00Z');
const EXPIRES = '2026-11-29T10:00:00.000Z';
const DISCLOSURES = [
  {
    processor: 'openai',
    label: '架空事業者（テスト）',
    purpose: '架空の作品カルテ候補抽出',
    dataSent: '架空作品の短い本文抜粋のみ',
    retention: '架空の保存説明：本番では使用禁止',
    internationalTransfer: '架空の国外処理説明：本番では使用禁止'
  }
];

function fixture({
  actor = OWNER,
  novelOwner = OWNER,
  enabled = true,
  corrupt = false,
  dbError = false
} = {}) {
  const db = new Map();
  const calls = { auth: 0, scope: 0, reads: 0, grants: 0, revokes: 0 };
  const client = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        calls.auth += 1;
        return { data: { user: { id: actor } }, error: null };
      }
    },
    from(table) {
      if (table === 'novels') {
        return {
          select() {
            return this;
          },
          eq(column, id) {
            assert.equal(column, 'id');
            assert.equal(id, 41);
            return this;
          },
          async maybeSingle() {
            calls.scope += 1;
            return {
              data: { id: 41, user_id: novelOwner },
              error: null
            };
          }
        };
      }
      assert.equal(table, 'novelight_ai_external_processing_consents');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in(column, processors) {
          assert.equal(column, 'processor');
          assert.deepEqual(processors, ['openai']);
          return this;
        },
        async limit(n) {
          calls.reads += 1;
          assert.equal(n, 2);
          if (dbError) return { data: null, error: { code: 'DB_DOWN' } };
          const row = db.get('openai');
          return {
            data: corrupt ? [row, row].filter(Boolean) : row ? [row] : [],
            error: null
          };
        }
      };
    },
    async rpc(name, args) {
      assert.equal(args.p_actor_id, OWNER);
      assert.equal(args.p_novel_id, 41);
      assert.equal(args.p_processor, 'openai');
      if (dbError) return { data: null, error: { code: 'DB_DOWN' } };
      if (name === 'novelight_ai_consent_grant') {
        calls.grants += 1;
        assert.equal(args.p_policy_revision, REVISION);
        db.set('openai', {
          processor: 'openai',
          policy_revision: REVISION,
          granted_at: '2026-10-30T10:00:00.000Z',
          expires_at: EXPIRES,
          revoked_at: null
        });
        return {
          data: {
            status: 'granted',
            processor: 'openai',
            policyRevision: REVISION,
            expiresAt: EXPIRES
          },
          error: null
        };
      }
      assert.equal(name, 'novelight_ai_consent_revoke');
      calls.revokes += 1;
      db.set('openai', {
        ...db.get('openai'),
        revoked_at: '2026-10-30T10:01:00.000Z'
      });
      return {
        data: {
          status: 'revoked',
          processor: 'openai',
          revokedAt: '2026-10-30T10:01:00.000Z'
        },
        error: null
      };
    }
  };
  const runtime = createOwnerNovelBibleConsentRuntime({
    enabled,
    ownerId: OWNER,
    serviceClient: client,
    policyRevision: REVISION,
    disclosures: DISCLOSURES,
    now: () => FIXED_NOW
  });
  return { runtime, client, calls, db };
}

test('policy activation requires a dedicated flag and complete, unique provider notices', () => {
  const env = {
    NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED: 'true',
    NOVELIGHT_AI_CONSENT_POLICY_REVISION: REVISION,
    NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify(DISCLOSURES)
  };
  assert.equal(resolveOwnerNovelBibleConsentRuntimePolicy({}), null);
  assert.equal(
    resolveOwnerNovelBibleConsentRuntimePolicy({
      ...env,
      NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED: 'false'
    }),
    null
  );
  assert.equal(
    resolveOwnerNovelBibleConsentRuntimePolicy({
      ...env,
      NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
        DISCLOSURES[0],
        DISCLOSURES[0]
      ])
    }),
    null
  );
  assert.equal(
    resolveOwnerNovelBibleConsentRuntimePolicy({
      ...env,
      NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
        { ...DISCLOSURES[0], retention: '' }
      ])
    }),
    null
  );
  assert.equal(
    resolveOwnerNovelBibleConsentRuntimePolicy({
      ...env,
      NOVELIGHT_AI_CONSENT_POLICY_REVISION: 'old'
    }),
    null
  );
  assert.equal(
    resolveOwnerNovelBibleConsentRuntimePolicy(env)?.disclosures[0].processor,
    'openai'
  );
});

test('default-OFF runtime refuses read, grant and revoke', async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(
    f.runtime.read({ token: TOKEN, novelId: 41 }),
    /AI_CONSENT_ACTION_DISABLED/u
  );
  await assert.rejects(
    f.runtime.grant({
      token: TOKEN,
      novelId: 41,
      processor: 'openai',
      explicitAuthorAction: true,
      acceptedExternalProcessing: true,
      acceptedDisclosureRevision: REVISION
    }),
    /AI_CONSENT_ACTION_DISABLED/u
  );
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.grants, 0);
});

test('owner lifecycle read none -> explicitly grant -> active -> revoke', async () => {
  const f = fixture();
  const before = await f.runtime.read({ token: TOKEN, novelId: 41 });
  assert.equal(before.disclosures[0].status, 'none');
  assert.equal(before.aiEnabled, false);
  const grant = await f.runtime.grant({
    token: TOKEN,
    novelId: 41,
    processor: 'openai',
    explicitAuthorAction: true,
    acceptedExternalProcessing: true,
    acceptedDisclosureRevision: REVISION
  });
  assert.equal(grant.status, 'granted');
  const active = await f.runtime.read({ token: TOKEN, novelId: 41 });
  assert.equal(active.disclosures[0].status, 'active');
  assert.equal(active.disclosures[0].expiresAt, EXPIRES);
  const revoke = await f.runtime.revoke({
    token: TOKEN,
    novelId: 41,
    processor: 'openai',
    explicitAuthorAction: true
  });
  assert.equal(revoke.status, 'revoked');
  const after = await f.runtime.read({ token: TOKEN, novelId: 41 });
  assert.equal(after.disclosures[0].status, 'revoked');
  assert.equal(after.disclosures[0].expiresAt, null);
  assert.equal(f.calls.grants, 1);
  assert.equal(f.calls.revokes, 1);
  assert.ok(f.calls.auth >= 5);
});

test('wrong actor and wrong novel owner cannot even read consent status', async () => {
  for (const args of [{ actor: OTHER }, { novelOwner: OTHER }]) {
    const f = fixture(args);
    await assert.rejects(
      f.runtime.read({ token: TOKEN, novelId: 41 }),
      /AI_CONSENT_ACTION_DENIED/u
    );
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.grants, 0);
  }
});

test('missing, stale or duplicate consent rows never report active', async () => {
  const f = fixture();
  const granted = {
    processor: 'openai',
    policy_revision: REVISION,
    granted_at: '2026-10-30T10:00:00.000Z',
    expires_at: EXPIRES,
    revoked_at: null
  };
  f.db.set('openai', { ...granted, policy_revision: 'stale-version' });
  assert.equal(
    (await f.runtime.read({ token: TOKEN, novelId: 41 })).disclosures[0].status,
    'none'
  );
  f.db.set('openai', {
    ...granted,
    expires_at: '2026-10-30T09:00:00.000Z'
  });
  assert.equal(
    (await f.runtime.read({ token: TOKEN, novelId: 41 })).disclosures[0].status,
    'none'
  );
  f.db.set('openai', { ...granted, expires_at: 'not-a-time' });
  await assert.rejects(
    f.runtime.read({ token: TOKEN, novelId: 41 }),
    /AI_CONSENT_ACTION_UNAVAILABLE/u
  );
  const duplicates = fixture({ corrupt: true });
  duplicates.db.set('openai', granted);
  await assert.rejects(
    duplicates.runtime.read({ token: TOKEN, novelId: 41 }),
    /AI_CONSENT_ACTION_UNAVAILABLE/u
  );
});

test('SQL errors fail closed, and undisclosed processors cannot be granted', async () => {
  const f = fixture({ dbError: true });
  await assert.rejects(
    f.runtime.read({ token: TOKEN, novelId: 41 }),
    /AI_CONSENT_ACTION_UNAVAILABLE/u
  );
  await assert.rejects(
    f.runtime.grant({
      token: TOKEN,
      novelId: 41,
      processor: 'gemini',
      explicitAuthorAction: true,
      acceptedExternalProcessing: true,
      acceptedDisclosureRevision: REVISION
    }),
    /AI_CONSENT_ACTION_DENIED/u
  );
  assert.equal(f.calls.grants, 0);
});

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('owner-only API is actually wired to configured runtime, with no model calls', async () => {
  const f = fixture();
  const env = {
    NOVELIGHT_AI_CONSENT_UI_ENABLED: 'true',
    NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
    NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED: 'true',
    NOVELIGHT_AI_CONSENT_POLICY_REVISION: REVISION,
    NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify(DISCLOSURES),
    NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_offline_key',
    SUPABASE_SECRET_KEY: 'fake-service-secret-not-real'
  };
  let clients = 0;
  const handle = createOwnerBibleConsentApiHandler({
    env,
    createServiceClient() {
      clients += 1;
      return f.client;
    }
  });
  const base = {
    query: { novel_id: '41' },
    headers: {
      host: 'novelight.jp',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + TOKEN
    }
  };
  let res = response();
  await handle({ ...base, method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.disclosures[0].status, 'none');
  assert.equal(res.body.aiEnabled, false);

  res = response();
  await handle(
    {
      ...base,
      method: 'POST',
      headers: {
        ...base.headers,
        origin: 'https://novelight.jp',
        'content-type': 'application/json',
        'x-novelight-ai-consent': '1'
      },
      body: {
        action: 'grant',
        processor: 'openai',
        policyRevision: REVISION,
        acceptedExternalProcessing: true
      }
    },
    res
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'granted');
  assert.equal(res.body.aiEnabled, false);
  assert.equal(f.calls.grants, 1);
  assert.equal(clients, 2);
});

test('without approved runtime env, the deployed API never constructs a client', async () => {
  const env = {
    NOVELIGHT_AI_CONSENT_UI_ENABLED: 'true',
    NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
    NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_offline_key',
    SUPABASE_SECRET_KEY: 'fake-service-secret-not-real'
  };
  let clients = 0;
  const handle = createOwnerBibleConsentApiHandler({
    env,
    createServiceClient() {
      clients += 1;
      throw new Error('MUST_NOT_CONSTRUCT');
    }
  });
  const res = response();
  await handle(
    {
      method: 'GET',
      query: { novel_id: '41' },
      headers: {
        host: 'novelight.jp',
        'sec-fetch-site': 'same-origin',
        authorization: 'Bearer ' + TOKEN
      }
    },
    res
  );
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'AI_CONSENT_UNAVAILABLE');
  assert.equal(clients, 0);
});
