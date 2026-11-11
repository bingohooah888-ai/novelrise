import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { createSupabaseOwnerBibleReviewStateRepository } from '../api/_lib/ai/owner-bible-review-state-repository.js';
import { createOfflineOwnerBibleReviewStateWiring } from '../api/_lib/ai/owner-bible-review-state-offline-wiring.js';
import { createOfflineOwnerSessionCheck } from '../api/_lib/ai/owner-session-evidence.js';
import { createOfflinePrivateSessionReader } from '../api/_lib/ai/owner-private-session-reader.js';
import { createOfflineOwnerBibleReviewStateWorkflow } from '../api/_lib/ai/owner-bible-review-state-offline.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-signed-jwt-for-tests-only';
const ID_A = 'rv1-abcdef0123456789';
const ID_B = 'rv1-1234567890abcdef';
const SQL_PATH = new URL(
  '../reports/sql/novelight_ai_owner_review_state_PROPOSAL.sql',
  import.meta.url
);

function fixture() {
  const calls = [];
  const rows = new Map();
  let active = true;
  let signed = true;
  let ownership = ACTOR;
  let casError = null;
  let snapshotError = null;
  let invalidReceipt = null;
  const scope = ACTOR + ':17';
  const clients = {
    authClient: {
      auth: {
        getUser: async () => ({
          data: active ? { user: { id: ACTOR } } : null,
          error: active ? null : { message: 'signed out' }
        })
      }
    },
    serviceClient: {
      from(table) {
        calls.push(['from', table]);
        if (table === 'novels') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 17, user_id: ownership },
                  error: null
                })
              })
            })
          };
        }
        assert.equal(table, 'novelight_ai_owner_review_states');
        return {
          select(columns) {
            assert.equal(
              columns,
              'actor_id,novel_id,version,revision,reviewed_ids'
            );
            return this;
          },
          eq(column, value) {
            calls.push(['eq', column, value]);
            return this;
          },
          async maybeSingle() {
            if (snapshotError) return { data: null, error: snapshotError };
            return { data: rows.get(scope) ?? null, error: null };
          }
        };
      },
      async rpc(name, args) {
        calls.push(['rpc', name, args]);
        if (casError) return { data: null, error: casError };
        assert.equal(name, 'novelight_ai_owner_review_state_cas');
        assert.equal(args.p_actor_id, ACTOR);
        assert.equal(args.p_novel_id, 17);
        assert.equal(args.p_session_id, SESSION);
        assert.equal('bearerToken' in args, false);
        if (invalidReceipt) return { data: invalidReceipt, error: null };
        // Atomic mock representing a single database transaction. No await
        // between revision comparison and the state mutation.
        const old = rows.get(scope);
        if (args.p_expected_revision !== (old?.revision ?? 0)) {
          return { data: [], error: null };
        }
        const row = {
          actor_id: ACTOR,
          novel_id: 17,
          version: 1,
          revision: (old?.revision ?? 0) + 1,
          reviewed_ids: [...args.p_reviewed_ids]
        };
        rows.set(scope, row);
        return { data: [row], error: null };
      }
    }
  };

  const checkSession = createOfflineOwnerSessionCheck({
    verifySignedClaims: async (jwt) => {
      calls.push(['verifyClaims', jwt]);
      if (!signed) return { error: { message: 'bad signature' } };
      return {
        data: {
          claims: {
            sub: ACTOR,
            session_id: SESSION,
            role: 'authenticated',
            aud: 'authenticated',
            exp: 999999,
            iat: 100,
            is_anonymous: false
          }
        },
        error: null
      };
    },
    readExistingSession: createOfflinePrivateSessionReader({
      lookupOneSession: async ({ sessionId, actorId }) => {
        calls.push(['sessionLookup', sessionId, actorId]);
        return active && sessionId === SESSION && actorId === ACTOR;
      }
    }),
    nowEpochSeconds: () => 500
  });

  const repository = createSupabaseOwnerBibleReviewStateRepository({
    serviceClient: clients.serviceClient,
    checkSession
  });
  return {
    calls,
    rows,
    clients,
    repository,
    checkSession,
    setActive: (v) => (active = v),
    setSigned: (v) => (signed = v),
    setOwner: (v) => (ownership = v),
    setCasError: (v) => (casError = v),
    setSnapshotError: (v) => (snapshotError = v),
    setReceipt: (v) => (invalidReceipt = v)
  };
}

const scope = {
  actorId: ACTOR,
  novelId: 17,
  bearerToken: TOKEN
};

test('constructor requires scoped server capabilities, never creates a client', () => {
  assert.throws(
    () => createSupabaseOwnerBibleReviewStateRepository(),
    /UNAVAILABLE/
  );
  assert.throws(
    () =>
      createSupabaseOwnerBibleReviewStateRepository({
        serviceClient: { from() {}, rpc() {} }
      }),
    /UNAVAILABLE/
  );
});

test('reader rejects unsigned, revoked, foreign and unscoped requests before DB', async () => {
  const f = fixture();
  for (const bad of [
    { ...scope, actorId: 'wrong' },
    { ...scope, novelId: 0 },
    { ...scope, bearerToken: 'tiny' }
  ]) {
    await assert.rejects(f.repository.readSnapshot(bad), /UNAVAILABLE/);
  }
  assert.equal(f.calls.length, 0);
  f.setSigned(false);
  await assert.rejects(f.repository.readSnapshot(scope), /UNAVAILABLE/);
  assert.equal(f.calls.filter(([name]) => name === 'from').length, 0);
  f.setSigned(true);
  f.setActive(false);
  await assert.rejects(f.repository.readSnapshot(scope), /UNAVAILABLE/);
  assert.equal(f.calls.filter(([name]) => name === 'from').length, 0);
});

test('missing row is revision zero in workflow; repeated reads are scoped and re-attested', async () => {
  const f = fixture();
  assert.equal(await f.repository.readSnapshot(scope), null);
  assert.deepEqual(
    f.calls.filter(([name]) => name === 'eq'),
    [
      ['eq', 'actor_id', ACTOR],
      ['eq', 'novel_id', 17]
    ]
  );
  assert.equal(f.calls.filter(([name]) => name === 'sessionLookup').length, 2);
});

test('insert and update go through one service-only atomic RPC with session binding', async () => {
  const f = fixture();
  const first = await f.repository.compareAndSwap({
    ...scope,
    expectedRevision: 0,
    reviewedIds: [ID_B, ID_A]
  });
  assert.deepEqual(first, {
    actorId: ACTOR,
    novelId: 17,
    version: 1,
    revision: 1,
    reviewedIds: [ID_B, ID_A]
  });
  const second = await f.repository.compareAndSwap({
    ...scope,
    expectedRevision: 1,
    reviewedIds: [ID_B]
  });
  assert.equal(second.revision, 2);
  assert.deepEqual(second.reviewedIds, [ID_B]);
  const stale = await f.repository.compareAndSwap({
    ...scope,
    expectedRevision: 1,
    reviewedIds: []
  });
  assert.equal(stale, null);
  assert.equal(f.rows.get(ACTOR + ':17').revision, 2);
  assert.equal(f.calls.filter(([name]) => name === 'rpc').length, 3);
});

test('two concurrent first writers at expectedRevision 0 cannot both insert', async () => {
  const f = fixture();
  const both = await Promise.all([
    f.repository.compareAndSwap({
      ...scope,
      expectedRevision: 0,
      reviewedIds: [ID_A]
    }),
    f.repository.compareAndSwap({
      ...scope,
      expectedRevision: 0,
      reviewedIds: [ID_B]
    })
  ]);
  assert.equal(both.filter(Boolean).length, 1);
  assert.equal(both.filter((v) => v === null).length, 1);
  assert.equal(f.rows.get(ACTOR + ':17').revision, 1);
});

test('revoked signed session, bad signature and scope mismatch cannot call CAS', async () => {
  const f = fixture();
  f.setActive(false);
  await assert.rejects(
    f.repository.compareAndSwap({
      ...scope,
      expectedRevision: 0,
      reviewedIds: [ID_A]
    }),
    /UNAVAILABLE/
  );
  f.setActive(true);
  f.setSigned(false);
  await assert.rejects(
    f.repository.compareAndSwap({
      ...scope,
      expectedRevision: 0,
      reviewedIds: [ID_A]
    }),
    /UNAVAILABLE/
  );
  f.setSigned(true);
  for (const args of [
    { ...scope, actorId: FOREIGN, expectedRevision: 0, reviewedIds: [ID_A] },
    { ...scope, expectedRevision: 0, reviewedIds: [ID_A, ID_A] },
    { ...scope, expectedRevision: 0, reviewedIds: ['other'] },
    { ...scope, expectedRevision: 2147483647, reviewedIds: [] }
  ]) {
    await assert.rejects(f.repository.compareAndSwap(args), /UNAVAILABLE/);
  }
  assert.equal(f.calls.filter(([name]) => name === 'rpc').length, 0);
});

test('SQL/transport failure and malformed or forged receipts fail closed', async () => {
  const f = fixture();
  f.setCasError({ code: '42501' });
  await assert.rejects(
    f.repository.compareAndSwap({
      ...scope,
      expectedRevision: 0,
      reviewedIds: [ID_A]
    }),
    /UNAVAILABLE/
  );
  f.setCasError(null);
  for (const data of [
    [
      {
        actor_id: FOREIGN,
        novel_id: 17,
        version: 1,
        revision: 1,
        reviewed_ids: [ID_A]
      }
    ],
    [
      {
        actor_id: ACTOR,
        novel_id: 18,
        version: 1,
        revision: 1,
        reviewed_ids: [ID_A]
      }
    ],
    [
      {
        actor_id: ACTOR,
        novel_id: 17,
        version: 1,
        revision: 4,
        reviewed_ids: [ID_A]
      }
    ],
    [
      {
        actor_id: ACTOR,
        novel_id: 17,
        version: 1,
        revision: 1,
        reviewed_ids: ['bad']
      }
    ],
    [
      {
        actor_id: ACTOR,
        novel_id: 17,
        version: 1,
        revision: 1,
        reviewed_ids: [ID_A]
      },
      {
        actor_id: ACTOR,
        novel_id: 17,
        version: 1,
        revision: 1,
        reviewed_ids: [ID_A]
      }
    ]
  ]) {
    f.setReceipt(data);
    await assert.rejects(
      f.repository.compareAndSwap({
        ...scope,
        expectedRevision: 0,
        reviewedIds: [ID_A]
      }),
      /UNAVAILABLE/
    );
  }
});

test('missing or malformed row cannot leak another owner private snapshot', async () => {
  const f = fixture();
  f.rows.set(ACTOR + ':17', {
    actor_id: FOREIGN,
    novel_id: 17,
    version: 1,
    revision: 1,
    reviewed_ids: [ID_A]
  });
  await assert.rejects(f.repository.readSnapshot(scope), /UNAVAILABLE/);
  f.rows.clear();
  f.setSnapshotError({ code: '42501' });
  await assert.rejects(f.repository.readSnapshot(scope), /UNAVAILABLE/);
});

test('workflow forwards only the authenticated bearer to the trusted repository and checks novel ownership', async () => {
  const f = fixture();
  const work = createOfflineOwnerBibleReviewStateWorkflow({
    enabled: true,
    ownerId: ACTOR,
    authClient: f.clients.authClient,
    serviceClient: f.clients.serviceClient,
    repository: f.repository,
    readOwnerPreview: async () => ({
      novelId: 17,
      aiGenerated: false,
      characters: [],
      notes: [],
      facts: []
    })
  });
  const read = await work.read({ token: TOKEN, novelId: 17 });
  assert.deepEqual(read, {
    version: 1,
    novelId: 17,
    revision: 0,
    reviewedIds: []
  });
  const saved = await work.save({
    token: TOKEN,
    novelId: 17,
    expectedRevision: 0,
    reviewedIds: [],
    explicitAuthorAction: true
  });
  assert.equal(saved.revision, 1);
  f.setOwner(FOREIGN);
  await assert.rejects(
    work.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
});

test('SQL proposal requires service_role, RLS, ownership and signed session evidence', () => {
  const sql = readFileSync(SQL_PATH, 'utf8');
  assert.match(sql, /REVIEW-ONLY PROPOSAL\. NOT A MIGRATION\. DO NOT EXECUTE/);
  assert.match(sql, /create table public\.novelight_ai_owner_review_states/);
  assert.match(sql, /primary key \(actor_id, novel_id\)/);
  assert.match(sql, /references public\.novels\(id\) on delete cascade/);
  assert.match(sql, /create index novelight_ai_owner_review_novel_fk_idx/);
  assert.match(
    sql,
    /alter table public\.novelight_ai_owner_review_states enable row level security/
  );
  assert.match(
    sql,
    /for all to service_role using \(true\) with check \(true\)/
  );
  assert.match(
    sql,
    /revoke all on public\.novelight_ai_owner_review_states[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    sql,
    /revoke all on function public\.novelight_ai_owner_review_state_cas/
  );
  assert.match(
    sql,
    /grant execute on function public\.novelight_ai_owner_review_state_cas[\s\S]*to service_role/
  );
  assert.match(sql, /language plpgsql security invoker set search_path = ''/);
  const executableSql = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executableSql, /security definer/i);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.match(
    sql,
    /from public\.novels n[\s\S]*n\.user_id = p_actor_id[\s\S]*for share of n/
  );
  assert.match(
    sql,
    /from auth\.sessions s[\s\S]*s\.id = p_session_id and s\.user_id = p_actor_id[\s\S]*for share of s/
  );
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /p_expected_revision <> 0/);
  assert.match(sql, /on conflict \(actor_id, novel_id\) do nothing/);
  assert.match(sql, /s\.revision = p_expected_revision/);
  assert.match(
    sql,
    /returning s\.actor_id, s\.novel_id, s\.version, s\.revision, s\.reviewed_ids/
  );
  assert.match(sql, /v_text_id = any\(v_seen\)/);
  assert.match(sql, /p_expected_revision = 2147483647/);
  assert.equal(
    existsSync(
      new URL('../api/ai-owner-bible-review-state.js', import.meta.url)
    ),
    false
  );
  assert.equal(
    existsSync(
      new URL(
        '../supabase/migrations/20261111100000_novelight_ai_owner_review_state.sql',
        import.meta.url
      )
    ),
    false
  );
});

test('proposal does not modify candidate decision RPC or any author canon tables', () => {
  const sql = readFileSync(SQL_PATH, 'utf8');
  assert.doesNotMatch(
    sql,
    /create or replace function public\.novelight_ai_review_decide/
  );
  assert.doesNotMatch(sql, /update public\.novelight_ai_bible_facts/);
  assert.doesNotMatch(
    sql,
    /grant (?:select|insert|update|delete) on public\.novelight_ai_owner_review_states\s+to authenticated/i
  );
});

test('server-only wiring composes existing signed-session proof, CAS repository and review workflow', async () => {
  const f = fixture();
  let verified = 0;
  let lookups = 0;
  let active = true;
  const serviceClient = {
    ...f.clients.serviceClient,
    auth: {
      ...f.clients.authClient.auth,
      async getClaims(jwt) {
        assert.equal(jwt, TOKEN);
        verified += 1;
        return {
          data: {
            claims: {
              sub: ACTOR,
              session_id: SESSION,
              role: 'authenticated',
              aud: 'authenticated',
              exp: 999999,
              iat: 100,
              is_anonymous: false
            }
          },
          error: null
        };
      }
    }
  };
  const configuration = {
    ownerId: ACTOR,
    serviceClient,
    readOwnerPreview: async () => ({
      novelId: 17,
      aiGenerated: false,
      characters: [],
      notes: [],
      facts: []
    }),
    lookupOneSession: async ({ actorId, sessionId }) => {
      lookups += 1;
      return active && actorId === ACTOR && sessionId === SESSION;
    },
    nowEpochSeconds: () => 500
  };
  const disabled = createOfflineOwnerBibleReviewStateWiring(configuration);
  await assert.rejects(
    disabled.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DISABLED/
  );
  assert.equal(verified, 0);
  assert.equal(lookups, 0);

  const workflow = createOfflineOwnerBibleReviewStateWiring({
    ...configuration,
    enabled: true
  });
  assert.deepEqual(await workflow.read({ token: TOKEN, novelId: 17 }), {
    version: 1,
    novelId: 17,
    revision: 0,
    reviewedIds: []
  });
  const saved = await workflow.save({
    token: TOKEN,
    novelId: 17,
    expectedRevision: 0,
    reviewedIds: [],
    explicitAuthorAction: true
  });
  assert.equal(saved.revision, 1);
  assert.ok(verified >= 3);
  assert.ok(lookups >= 3);
  active = false;
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
});

test('offline server composition refuses missing signed verifier or privileged session capability', () => {
  const f = fixture();
  assert.throws(
    () =>
      createOfflineOwnerBibleReviewStateWiring({
        serviceClient: f.clients.serviceClient,
        readOwnerPreview: async () => null,
        lookupOneSession: async () => true,
        nowEpochSeconds: () => 500
      }),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
});

test('reader discards private row when the session is revoked mid-read', async () => {
  const f = fixture();
  const originalFrom = f.clients.serviceClient.from.bind(
    f.clients.serviceClient
  );
  f.clients.serviceClient.from = (table) => {
    const query = originalFrom(table);
    if (table === 'novelight_ai_owner_review_states') {
      const old = query.maybeSingle.bind(query);
      query.maybeSingle = async () => {
        const result = await old();
        f.setActive(false);
        return result;
      };
    }
    return query;
  };
  await assert.rejects(f.repository.readSnapshot(scope), /UNAVAILABLE/);
});
