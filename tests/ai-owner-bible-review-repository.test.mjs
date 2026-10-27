import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createSupabaseOwnerBibleReviewRepository } from '../api/_lib/ai/owner-bible-review-repository.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

function adapter({ rpcData = 1, rpcError = null } = {}) {
  const calls = [];
  const serviceClient = {
    from(table) {
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        order() {
          return this;
        },
        limit() {
          if (table === 'novelight_ai_bible_facts') {
            return { data: [{ fact_kind: 'world', fact_key: '王都' }] };
          }
          return { data: [] };
        },
        async maybeSingle() {
          if (table === 'novels') {
            return { data: { id: 354, user_id: OWNER } };
          }
          if (table === 'novelight_ai_review_candidates') {
            if (filters.some(([key, value]) => key === 'id' && value !== 5)) {
              return { data: null };
            }
            return {
              data: {
                id: 5,
                novel_id: 354,
                actor_id: OWNER,
                source_episode_id: 41,
                source_hash: HASH,
                fact_kind: 'character',
                fact_key: '凛',
                summary: '鍵を持つ',
                evidence: '鍵を持っていた',
                status: 'pending',
                revision: 1
              }
            };
          }
          return { data: null };
        }
      };
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (rpcError) return { error: rpcError };
      return {
        data: name.endsWith('decide')
          ? [{ status: 'accepted', revision: 2 }]
          : rpcData
      };
    }
  };
  const authorClient = {
    async rpc(name) {
      if (name === 'novelight_author_character_list') {
        return {
          data: [{ id: 1, name: '凛', aliases: [] }],
          error: null
        };
      }
      return { data: [], error: null };
    }
  };
  return {
    calls,
    store: createSupabaseOwnerBibleReviewRepository({
      serviceClient,
      authorClient
    })
  };
}

test('service adapter stages only allowlisted fields via atomic RPC', async () => {
  const { calls, store } = adapter();
  const result = await store.savePendingBatch({
    actorId: OWNER,
    novelId: 354,
    episodeId: 41,
    sourceHash: HASH,
    requestHash: HASH,
    candidates: [
      {
        factKind: 'character',
        factKey: '凛',
        factPayload: {
          summary: '鍵を持つ',
          evidence: '鍵を持っていた',
          privatePrompt: 'NEVER SEND'
        },
        provenance: 'ai_inferred',
        injectedRole: 'admin'
      }
    ]
  });
  assert.equal(result.count, 1);
  assert.equal(calls[0][0], 'novelight_ai_review_stage_batch');
  assert.deepEqual(calls[0][1].p_candidates, [
    {
      kind: 'character',
      key: '凛',
      summary: '鍵を持つ',
      evidence: '鍵を持っていた'
    }
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /NEVER SEND|injectedRole/);
});

test('decisions use compare-and-swap SQL RPC, not generic UPDATE', async () => {
  const { calls, store } = adapter();
  const result = await store.compareAndSwapDecision({
    actorId: OWNER,
    novelId: 354,
    candidateId: 5,
    sourceHash: HASH,
    expectedRevision: 1,
    expectedStatus: 'pending',
    decision: 'accepted'
  });
  assert.deepEqual(result, { status: 'accepted', revision: 2 });
  assert.equal(calls[0][0], 'novelight_ai_review_decide');
  assert.equal(calls[0][1].p_expected_revision, 1);
  assert.equal(calls[0][1].p_candidate_id, 5);
});

test('row queries scope candidates by actor, novel and ID', async () => {
  const { store } = adapter();
  const row = await store.readCandidate({
    actorId: OWNER,
    novelId: 354,
    candidateId: 5
  });
  assert.equal(row.id, 5);
  assert.equal(row.provenance, 'ai_inferred');
  assert.equal(row.sourceEpisodeId, 41);
  assert.equal(row.sourceHash, HASH);
});

test('canonical names come from author JWT RPC, not AI proposals', async () => {
  const { store } = adapter();
  const facts = await store.listAuthorConfirmed({
    actorId: OWNER,
    novelId: 354
  });
  assert.deepEqual(facts, [
    { kind: 'character', key: '凛' },
    { kind: 'world', key: '王都' }
  ]);
});

test('no storage mutation when missing identity, scope, or RPC errors', async () => {
  const { store, calls } = adapter({ rpcError: { message: 'denied' } });
  await assert.rejects(
    store.savePendingBatch({
      actorId: 'wrong',
      novelId: 354,
      episodeId: 41,
      sourceHash: HASH,
      requestHash: HASH,
      candidates: []
    }),
    /AI_REVIEW_STORAGE_UNAVAILABLE/
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    store.compareAndSwapDecision({
      actorId: OWNER,
      novelId: 354,
      candidateId: 5,
      sourceHash: HASH,
      expectedRevision: 1,
      expectedStatus: 'pending',
      decision: 'accepted'
    }),
    /AI_REVIEW_STORAGE_UNAVAILABLE/
  );
});

test('proposed SQL is restricted to service_role and not in migrations', async () => {
  const sql = await readFile(
    new URL(
      '../reports/sql/novelight_ai_review_candidates_PROPOSAL.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(sql, /security invoker/);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /unique \(actor_id, request_hash, fact_kind, fact_key\)/);
  assert.match(sql, /p_expected_revision/);
  assert.match(sql, /status = 'pending'/);
});
