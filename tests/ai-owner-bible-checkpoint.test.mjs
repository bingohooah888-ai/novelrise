// Synthetic-only checkpoint tests. No service credentials or hosted DB.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const cloneSnapshot = (value) => JSON.parse(JSON.stringify(value));

import {
  createOfflineOwnerNovelBibleCheckpoint,
  createSupabaseOwnerNovelBibleCheckpointRepository
} from '../api/_lib/ai/owner-novel-bible-checkpoint.js';
import { planNovelBibleChangedChunks } from '../api/_lib/ai/novel-bible-chunks.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOVEL = { id: 41, user_id: OWNER };
const EPISODE = {
  id: 11,
  novel_id: 41,
  title: '第一話',
  content: '青'.repeat(4500)
};

function syntheticPlan(episode = EPISODE) {
  return {
    ...planNovelBibleChangedChunks({
      principal: { id: OWNER },
      novel: NOVEL,
      episodes: [episode],
      analyses: [],
      limit: 1
    }),
    analyses: []
  };
}

function fakeJournal(initialRow = null) {
  let row = initialRow === null ? null : cloneSnapshot(initialRow);
  const calls = { read: 0, cas: 0 };
  const repository = {
    async readSnapshot() {
      calls.read += 1;
      return row === null ? null : cloneSnapshot(row);
    },
    async compareAndSwap(change) {
      calls.cas += 1;
      if (
        change.expectedRevision !== (row?.revision ?? null) ||
        change.expectedSourceHash !== (row?.source_hash ?? null)
      ) {
        return null;
      }
      row = {
        episode_id: 11,
        source_hash: change.nextSourceHash,
        revision: (row?.revision ?? 0) + 1,
        summary: cloneSnapshot(change.nextSummary)
      };
      return cloneSnapshot(row);
    }
  };
  return {
    repository,
    calls,
    get row() {
      return row === null ? null : cloneSnapshot(row);
    }
  };
}

function args(plan, chunkIndex) {
  return {
    actorId: OWNER,
    novelId: 41,
    episodeId: 11,
    plan,
    chunkIndex
  };
}

test('partial chunks survive restart; only last acknowledgement changes analyzed hash', async () => {
  const plan = syntheticPlan();
  assert.ok(plan.chunks.length >= 3);
  const store = fakeJournal();
  let checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  assert.equal(await checkpoint.inspect(args(plan, 0)), 'pending');
  const first = await checkpoint.record(args(plan, 0));
  assert.equal(first.complete, false);
  assert.equal(first.remainingChunks, plan.chunks.length - 1);
  assert.equal(store.row.summary.novelightPhase2.state, 'in_progress');
  assert.equal(store.row.source_hash, '0'.repeat(64));

  // New request/process; the same scoped CAS repository is the only state.
  checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  assert.equal(await checkpoint.inspect(args(plan, 0)), 'completed');
  assert.equal(await checkpoint.inspect(args(plan, 1)), 'pending');
  assert.deepEqual(await checkpoint.record(args(plan, 0)), {
    complete: false,
    alreadyRecorded: true,
    remainingChunks: plan.chunks.length - 1
  });
  assert.equal(store.calls.cas, 1);

  for (let i = 1; i < plan.chunks.length; i += 1) {
    const status = await checkpoint.record(args(plan, i));
    assert.equal(status.complete, i === plan.chunks.length - 1);
  }
  assert.equal(store.calls.cas, plan.chunks.length);
  assert.equal(store.row.source_hash, plan.chunks[0].sourceHash);
  assert.equal(store.row.summary.novelightPhase2.state, 'complete');
  assert.deepEqual(
    store.row.summary.novelightPhase2.completedIndices,
    plan.chunks.map((_, i) => i)
  );
  assert.equal(await checkpoint.inspect(args(plan, 0)), 'completed');
  assert.equal(store.calls.cas, plan.chunks.length);
});

test('existing acknowledged hash is retained until changed chunks all complete', async () => {
  const beforeHash = 'a'.repeat(64);
  const plan = syntheticPlan();
  plan.analyses = [{ episode_id: 11, source_hash: beforeHash }];
  const store = fakeJournal({
    episode_id: 11,
    source_hash: beforeHash,
    revision: 7,
    summary: { legacySummary: 'keep' }
  });
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  for (let i = 0; i < plan.chunks.length; i += 1) {
    await checkpoint.record(args(plan, i));
    assert.equal(
      store.row.source_hash,
      i === plan.chunks.length - 1 ? plan.chunks[0].sourceHash : beforeHash
    );
    assert.equal(store.row.summary.legacySummary, 'keep');
  }
  assert.equal(store.row.revision, 7 + plan.chunks.length);
});

test('changed chapter plan cannot reuse partial journal or forged scope', async () => {
  const plan = syntheticPlan();
  const store = fakeJournal();
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  await checkpoint.record(args(plan, 0));
  const changed = syntheticPlan({
    ...EPISODE,
    content: EPISODE.content + '改稿'
  });
  await assert.rejects(
    checkpoint.record(args(changed, 1)),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
  await assert.rejects(
    checkpoint.inspect({ ...args(plan, 0), novelId: 99 }),
    /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
  );
  assert.equal(store.calls.cas, 1);
});

test('atomic revision conflict or malformed receipt never reports completion', async () => {
  const plan = syntheticPlan();
  const storage = fakeJournal();
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: {
      readSnapshot: storage.repository.readSnapshot,
      compareAndSwap: async () => null
    }
  });
  await assert.rejects(
    checkpoint.record(args(plan, 0)),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
  assert.equal(storage.row, null);
  const forged = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: {
      readSnapshot: storage.repository.readSnapshot,
      compareAndSwap: async () => ({
        episode_id: 11,
        source_hash: plan.chunks[0].sourceHash,
        revision: 1,
        summary: { novelightPhase2: { state: 'complete' } }
      })
    }
  });
  await assert.rejects(
    forged.record(args(plan, 0)),
    /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
  );
});

test('OFF factory never reads state or charges for AI', async () => {
  let reads = 0;
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    repository: {
      async readSnapshot() {
        reads += 1;
      },
      async compareAndSwap() {
        throw new Error('not allowed');
      }
    }
  });
  await assert.rejects(
    checkpoint.inspect(args(syntheticPlan(), 0)),
    /AI_BIBLE_CHECKPOINT_DISABLED/u
  );
  assert.equal(reads, 0);
});

test('production adapter uses ONLY scoped atomic RPC; never direct table writes', async () => {
  const current = syntheticPlan().chunks[0].sourceHash;
  let row = null;
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'novelight_ai_episode_analysis');
      return {
        select() {
          return this;
        },
        eq(key, value) {
          assert.equal(key, 'episode_id');
          assert.equal(value, 11);
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
        insert() {
          assert.fail('direct INSERT would bypass the source lock');
        },
        update() {
          assert.fail('direct UPDATE would bypass the source lock');
        }
      };
    },
    async rpc(name, params) {
      assert.equal(name, 'novelight_ai_checkpoint_cas_v1');
      assert.equal(params.p_actor_id, OWNER);
      assert.equal(params.p_novel_id, 41);
      assert.equal(params.p_episode_id, 11);
      assert.equal(params.p_target_source_hash, current);
      calls.push(params);
      if (
        params.p_expected_revision !== (row?.revision ?? null) ||
        params.p_expected_source_hash !== (row?.source_hash ?? null)
      ) {
        return { data: [], error: null };
      }
      row = {
        episode_id: 11,
        source_hash: params.p_next_source_hash,
        revision: (row?.revision ?? 0) + 1,
        summary: {
          ...(row?.summary ?? {}),
          ...(params.p_next_progress
            ? { novelightPhase2: params.p_next_progress }
            : {})
        }
      };
      return { data: [row], error: null };
    }
  };
  const repo = createSupabaseOwnerNovelBibleCheckpointRepository({
    serviceClient: client
  });
  assert.equal(await repo.readSnapshot({ episodeId: 11 }), null);
  const plan = syntheticPlan();
  const ownerCheckpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: repo
  });
  const first = await ownerCheckpoint.record(args(plan, 0));
  assert.equal(first.complete, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_action, 'record');
  assert.equal(calls[0].p_chunk_index, 0);
  assert.equal(calls[0].p_expected_revision, null);
  assert.equal(calls[0].p_next_source_hash, '0'.repeat(64));
  for (let i = 1; i < plan.chunks.length; i += 1) {
    await ownerCheckpoint.record(args(plan, i));
  }
  assert.equal(row.source_hash, plan.chunks[0].sourceHash);
  assert.equal(row.summary.novelightPhase2.state, 'complete');
  assert.equal(row.revision, plan.chunks.length);
});

test('atomic adapter denies missing RPC and fails closed on DB errors/conflicts', async () => {
  const plan = syntheticPlan();
  const scope = args(plan, 0);
  const read = () => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: null, error: null };
    }
  });
  assert.throws(
    () =>
      createSupabaseOwnerNovelBibleCheckpointRepository({
        serviceClient: { from: read }
      }),
    /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
  );
  const errorRepo = createSupabaseOwnerNovelBibleCheckpointRepository({
    serviceClient: {
      from: read,
      async rpc() {
        return { data: null, error: { message: 'RPC missing' } };
      }
    }
  });
  const errorCheckpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: errorRepo
  });
  await assert.rejects(
    errorCheckpoint.record(scope),
    /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
  );
  const conflictRepo = createSupabaseOwnerNovelBibleCheckpointRepository({
    serviceClient: {
      from: read,
      async rpc() {
        return { data: [], error: null };
      }
    }
  });
  const conflictCheckpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: conflictRepo
  });
  await assert.rejects(
    conflictCheckpoint.record(scope),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
});

test('synthetic owner transfer and manuscript race reject checkpoint commits', async () => {
  // This tests the adapter contract, NOT PostgreSQL locking. Independent
  // database-session locks must be verified in isolated Staging separately.
  const plan = syntheticPlan();
  const source = plan.chunks[0].sourceHash;
  for (const change of ['owner', 'content']) {
    let currentOwner = OWNER;
    let currentHash = source;
    let writes = 0;
    const client = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: null, error: null };
          }
        };
      },
      async rpc(_name, params) {
        if (change === 'owner')
          currentOwner = '22222222-2222-4222-8222-222222222222';
        else currentHash = 'e'.repeat(64);
        if (
          params.p_actor_id !== currentOwner ||
          params.p_target_source_hash !== currentHash
        ) {
          return { data: null, error: { message: 'stale/foreign' } };
        }
        writes += 1;
        return { data: [], error: null };
      }
    };
    const repository = createSupabaseOwnerNovelBibleCheckpointRepository({
      serviceClient: client
    });
    const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
      enabled: true,
      repository
    });
    await assert.rejects(
      checkpoint.record(args(plan, 0)),
      /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
    );
    assert.equal(writes, 0);
  }
});

function changedZeroPlan(before, after) {
  const previous = {
    episode_id: 11,
    source_hash: createHash('sha256')
      .update(JSON.stringify([before.title, before.content]))
      .digest('hex')
  };
  return {
    ...planNovelBibleChangedChunks({
      principal: { id: OWNER },
      novel: NOVEL,
      episodes: [after],
      analyses: [previous],
      previousEpisodes: [before],
      limit: 1
    }),
    analyses: [previous]
  };
}

test('new empty chapter is completed with zero model chunks and no false interim hash', async () => {
  const plan = syntheticPlan({ ...EPISODE, content: '' });
  assert.deepEqual(
    plan.zeroChangedSources.map((x) => x.reason),
    ['empty-body']
  );
  const store = fakeJournal();
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  const change = await checkpoint.completeEmpty(args(plan, 0));
  assert.deepEqual(change, {
    complete: true,
    alreadyRecorded: false,
    remainingChunks: 0
  });
  assert.equal(store.calls.cas, 1);
  assert.equal(store.row.source_hash, plan.zeroChangedSources[0].sourceHash);
  assert.equal(store.row.summary.novelightPhase2.chunkCount, 0);
  assert.equal(store.row.summary.novelightPhase2.state, 'complete');
  assert.deepEqual(await checkpoint.completeEmpty(args(plan, 0)), {
    complete: true,
    alreadyRecorded: true,
    remainingChunks: 0
  });
  assert.equal(store.calls.cas, 1);
});

test('deletion-only and verified title-only changes promote source without provider', async () => {
  for (const [before, after, reason] of [
    [
      { ...EPISODE, content: '冒頭と削除対象と結末' },
      { ...EPISODE, content: '冒頭と結末' },
      'deletion-only'
    ],
    [
      { ...EPISODE, content: '同じ本文', title: '旧題' },
      { ...EPISODE, content: '同じ本文', title: '新題' },
      'title-only'
    ]
  ]) {
    const plan = changedZeroPlan(before, after);
    assert.deepEqual(plan.chunks, []);
    assert.equal(plan.zeroChangedSources[0].reason, reason);
    const previousHash = plan.analyses[0].source_hash;
    const store = fakeJournal({
      episode_id: 11,
      source_hash: previousHash,
      revision: 4,
      summary: { oldMetadata: 'preserved' }
    });
    const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
      enabled: true,
      repository: store.repository
    });
    assert.equal(
      (await checkpoint.completeEmpty(args(plan, 0))).complete,
      true
    );
    assert.equal(store.row.revision, 5);
    assert.equal(store.row.summary.oldMetadata, 'preserved');
    assert.equal(store.row.source_hash, plan.zeroChangedSources[0].sourceHash);
  }
});

test('mid-analysis manuscript revision drops old incomplete indices through CAS', async () => {
  const initial = syntheticPlan();
  const edited = syntheticPlan({
    ...EPISODE,
    content: EPISODE.content + '改稿'
  });
  const store = fakeJournal();
  let checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  await checkpoint.record(args(initial, 0));
  const previousRevision = store.row.revision;
  assert.deepEqual(store.row.summary.novelightPhase2.completedIndices, [0]);
  assert.equal(await checkpoint.inspect(args(edited, 0)), 'replan');
  assert.deepEqual(await checkpoint.replan(args(edited, 0)), {
    replanned: true,
    remainingChunks: edited.chunks.length
  });
  assert.equal(store.row.revision, previousRevision + 1);
  assert.deepEqual(store.row.summary.novelightPhase2.completedIndices, []);
  assert.equal(
    store.row.summary.novelightPhase2.targetSourceHash,
    edited.chunks[0].sourceHash
  );
  await assert.rejects(
    checkpoint.record(args(initial, 1)),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
  assert.equal(await checkpoint.inspect(args(edited, 0)), 'pending');

  checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  for (let i = 0; i < edited.chunks.length; i += 1) {
    const receipt = await checkpoint.record(args(edited, i));
    assert.equal(receipt.complete, i === edited.chunks.length - 1);
  }
  assert.equal(store.row.summary.novelightPhase2.state, 'complete');
  assert.equal(store.row.source_hash, edited.chunks[0].sourceHash);
});

test('a new zero-text revision discards a stale partial journal in one CAS', async () => {
  const initial = syntheticPlan();
  const store = fakeJournal();
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  await checkpoint.record(args(initial, 0));
  const zero = syntheticPlan({ ...EPISODE, content: '' });
  assert.equal((await checkpoint.completeEmpty(args(zero, 0))).complete, true);
  assert.equal(store.calls.cas, 2);
  assert.equal(store.row.summary.novelightPhase2.chunkCount, 0);
  assert.deepEqual(store.row.summary.novelightPhase2.completedIndices, []);
  await assert.rejects(
    checkpoint.record(args(initial, 1)),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
});

test('CAS conflict blocks a stale replan without silently dropping old progress', async () => {
  const initial = syntheticPlan();
  const edited = syntheticPlan({
    ...EPISODE,
    content: EPISODE.content + '変更'
  });
  const store = fakeJournal();
  await createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  }).record(args(initial, 0));
  const snapshot = store.row;
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: {
      readSnapshot: store.repository.readSnapshot,
      compareAndSwap: async () => null
    }
  });
  await assert.rejects(
    checkpoint.replan(args(edited, 0)),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
  assert.deepEqual(store.row, snapshot);
});

test('restored completed manuscript discards only stale partial progress by CAS', async () => {
  const old = { ...EPISODE, content: '既存の確認済み本文' };
  const changed = { ...EPISODE, content: '書き換えた本文'.repeat(500) };
  const plan = changedZeroPlan(old, changed);
  assert.ok(plan.chunks.length > 1);
  const originalHash = plan.analyses[0].source_hash;
  const store = fakeJournal({
    episode_id: 11,
    source_hash: originalHash,
    revision: 5,
    summary: { authorMetadata: 'keep' }
  });
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  await checkpoint.record(args(plan, 0));
  assert.equal(store.row.summary.novelightPhase2.state, 'in_progress');
  assert.deepEqual(
    await checkpoint.discardRestored({
      actorId: OWNER,
      novelId: 41,
      episodeId: 11,
      sourceHash: originalHash
    }),
    { discarded: true }
  );
  assert.equal(store.row.source_hash, originalHash);
  assert.equal(store.row.summary.authorMetadata, 'keep');
  assert.equal('novelightPhase2' in store.row.summary, false);
  assert.equal(store.row.revision, 7);
  assert.deepEqual(
    await checkpoint.discardRestored({
      actorId: OWNER,
      novelId: 41,
      episodeId: 11,
      sourceHash: originalHash
    }),
    { discarded: false }
  );
  assert.equal(store.calls.cas, 2);
});

test('restoration cannot erase another source or fake owner progress', async () => {
  const plan = syntheticPlan();
  const store = fakeJournal();
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: store.repository
  });
  await checkpoint.record(args(plan, 0));
  const snapshot = store.row;
  await assert.rejects(
    checkpoint.discardRestored({
      actorId: OWNER,
      novelId: 41,
      episodeId: 11,
      sourceHash: plan.chunks[0].sourceHash
    }),
    /AI_BIBLE_CHECKPOINT_CONFLICT/u
  );
  await assert.rejects(
    checkpoint.discardRestored({
      actorId: 'not-a-signed-owner',
      novelId: 41,
      episodeId: 11,
      sourceHash: 'a'.repeat(64)
    }),
    /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u
  );
  assert.deepEqual(store.row, snapshot);
});
