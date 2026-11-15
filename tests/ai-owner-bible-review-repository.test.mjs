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

test('service repository keyset pages 130 rows without ever skipping or repeating', async () => {
  const records = Array.from({ length: 130 }, (_, i) => ({
    id: i + 1,
    actor_id: OWNER,
    novel_id: 354,
    source_episode_id: 41,
    source_hash: HASH,
    fact_kind: 'character',
    fact_key: '凛',
    summary: '候補 ' + (i + 1),
    evidence: '鍵を持っていた',
    status: i % 2 ? 'accepted' : 'pending',
    revision: i % 2 ? 2 : 1
  }));
  const queries = [];
  const serviceClient = {
    from(table) {
      assert.equal(table, 'novelight_ai_review_candidates');
      const filters = [];
      let beforeId = null;
      return {
        select() {
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        in(key, values) {
          assert.equal(key, 'status');
          assert.deepEqual(values, ['pending', 'accepted']);
          return this;
        },
        lt(key, value) {
          assert.equal(key, 'id');
          beforeId = value;
          return this;
        },
        order(key, options) {
          assert.equal(key, 'id');
          assert.deepEqual(options, { ascending: false });
          return this;
        },
        async limit(number) {
          assert.equal(number, 26);
          assert.deepEqual(filters, [
            ['actor_id', OWNER],
            ['novel_id', 354]
          ]);
          queries.push(beforeId);
          return {
            data: records
              .filter((row) => beforeId === null || row.id < beforeId)
              .sort((a, b) => b.id - a.id)
              .slice(0, number),
            error: null
          };
        }
      };
    },
    rpc() {}
  };
  const store = createSupabaseOwnerBibleReviewRepository({
    serviceClient,
    authorClient: { rpc() {} }
  });
  let beforeId = null;
  const ids = [];
  do {
    const page = await store.listReviewPage({
      actorId: OWNER,
      novelId: 354,
      beforeId
    });
    assert.ok(page.rows.length > 0 && page.rows.length <= 25);
    ids.push(...page.rows.map((row) => row.id));
    beforeId = page.nextBeforeId;
  } while (beforeId !== null);
  assert.deepEqual(
    ids,
    Array.from({ length: 130 }, (_, i) => 130 - i)
  );
  assert.deepEqual(queries, [null, 106, 81, 56, 31, 6]);
});

test('repository rejects malformed or unsafe review cursors before reads', async () => {
  const { store } = adapter();
  for (const beforeId of [-1, 0, 'NaN', {}, 1.5]) {
    await assert.rejects(
      store.listReviewPage({ actorId: OWNER, novelId: 354, beforeId }),
      /AI_REVIEW_STORAGE_UNAVAILABLE/u
    );
  }
  await assert.rejects(
    store.listReviewPage({
      actorId: 'not-an-owner',
      novelId: 354,
      beforeId: null
    }),
    /AI_REVIEW_STORAGE_UNAVAILABLE/u
  );
});

test('cross-page older revision lookup enforces exact work, chapter and fact identity', async () => {
  const currentHash = 'c'.repeat(64);
  const historical = [
    { id: 1, actor_id: OWNER, novel_id: 354, source_episode_id: 41, fact_kind: 'character', fact_key: '凛', status: 'accepted', source_hash: HASH },
    { id: 2, actor_id: OWNER, novel_id: 354, source_episode_id: 41, fact_kind: 'character', fact_key: '凛', status: 'pending', source_hash: currentHash },
    { id: 3, actor_id: OWNER, novel_id: 355, source_episode_id: 41, fact_kind: 'character', fact_key: '凛', status: 'pending', source_hash: HASH },
    { id: 4, actor_id: OWNER, novel_id: 354, source_episode_id: 42, fact_kind: 'character', fact_key: '凛', status: 'pending', source_hash: HASH },
    { id: 5, actor_id: OWNER, novel_id: 354, source_episode_id: 41, fact_kind: 'event', fact_key: '凛', status: 'pending', source_hash: HASH },
    { id: 6, actor_id: OWNER, novel_id: 354, source_episode_id: 41, fact_kind: 'character', fact_key: '別名', status: 'pending', source_hash: HASH },
    { id: 7, actor_id: '22222222-2222-4222-8222-222222222222', novel_id: 354, source_episode_id: 41, fact_kind: 'character', fact_key: '凛', status: 'pending', source_hash: HASH },
    { id: 150, actor_id: OWNER, novel_id: 354, source_episode_id: 41, fact_kind: 'character', fact_key: '凛', status: 'pending', source_hash: HASH }
  ];
  const searches = [];
  const serviceClient = {
    from(name) {
      assert.equal(name, 'novelight_ai_review_candidates');
      const filters = [];
      return {
        select(columns) {
          assert.equal(columns, 'id');
          return this;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return this;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return this;
        },
        neq(column, value) {
          filters.push((row) => row[column] !== value);
          return this;
        },
        lt(column, value) {
          filters.push((row) => row[column] < value);
          return this;
        },
        order(column, options) {
          assert.equal(column, 'id');
          assert.deepEqual(options, { ascending: false });
          return this;
        },
        async limit(size) {
          assert.equal(size, 1);
          searches.push(filters.length);
          return {
            data: historical
              .filter((row) => filters.every((testRow) => testRow(row)))
              .sort((a, b) => b.id - a.id)
              .slice(0, 1)
              .map(({ id }) => ({ id })),
            error: null
          };
        }
      };
    },
    rpc() {}
  };
  const repo = createSupabaseOwnerBibleReviewRepository({
    serviceClient,
    authorClient: { rpc() {} }
  });
  const candidates = [
    { id: 130, episodeId: 41, factKind: 'character', factKey: '凛', sourceHash: currentHash },
    { id: 131, episodeId: 42, factKind: 'character', factKey: '凛', sourceHash: currentHash },
    { id: 132, episodeId: 41, factKind: 'event', factKey: '凛', sourceHash: currentHash },
    { id: 133, episodeId: 41, factKind: 'character', factKey: '別名', sourceHash: currentHash }
  ];
  assert.deepEqual(
    await repo.listPriorVersionIds({ actorId: OWNER, novelId: 354, candidates }),
    [130, 131, 132, 133]
  );
  // False positive controls: matching current source is NOT a prior revision.
  assert.deepEqual(
    await repo.listPriorVersionIds({
      actorId: OWNER,
      novelId: 354,
      candidates: [
        { ...candidates[0], sourceHash: HASH, id: 100 },
        { ...candidates[0], factKey: '不在の人物', id: 101 },
        { ...candidates[0], episodeId: 99, id: 102 }
      ]
    }),
    [100]
  );
  assert.equal(searches.length, 7);
  assert.ok(searches.every((count) => count === 8));
});

test('prior-version lookup rejects malformed values and bound violations before DB', async () => {
  const { store } = adapter();
  const current = {
    id: 130,
    episodeId: 41,
    factKind: 'character',
    factKey: '凛',
    sourceHash: HASH
  };
  const bad = [
    [current, current],
    [{ ...current, sourceHash: 'invalid' }],
    [{ ...current, factKey: '' }],
    [{ ...current, factKind: 'admin' }],
    [{ ...current, episodeId: 0 }],
    Array.from({ length: 26 }, (_, i) => ({ ...current, id: i + 1 }))
  ];
  for (const candidates of bad) {
    await assert.rejects(
      store.listPriorVersionIds({ actorId: OWNER, novelId: 354, candidates }),
      /AI_REVIEW_STORAGE_UNAVAILABLE/u
    );
  }
});
