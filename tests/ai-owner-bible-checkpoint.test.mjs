// Synthetic-only checkpoint tests. No service credentials or hosted DB.
import assert from 'node:assert/strict';
import test from 'node:test';

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
  let row = initialRow === null ? null : structuredClone(initialRow);
  const calls = { read: 0, cas: 0 };
  const repository = {
    async readSnapshot() {
      calls.read += 1;
      return row === null ? null : structuredClone(row);
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
        summary: structuredClone(change.nextSummary)
      };
      return structuredClone(row);
    }
  };
  return {
    repository,
    calls,
    get row() {
      return row === null ? null : structuredClone(row);
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
  assert.equal(store.row.source_hash, plan.chunks[0].sourceHash);

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
      i === plan.chunks.length - 1
        ? plan.chunks[0].sourceHash
        : beforeHash
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

test('existing analysis table adapter performs insert then version-guarded update', async () => {
  let state = null;
  const writes = [];
  const serviceClient = {
    from(table) {
      assert.equal(table, 'novelight_ai_episode_analysis');
      return {
        select() {
          return this;
        },
        eq(field, value) {
          this.constraints ??= {};
          this.constraints[field] = value;
          return this;
        },
        async maybeSingle() {
          return { data: state, error: null };
        },
        insert(next) {
          writes.push(['insert', next]);
          assert.equal(state, null);
          state = next;
          return {
            select: () => ({
              maybeSingle: async () => ({ data: next, error: null })
            })
          };
        },
        update(next) {
          writes.push(['update', next]);
          return {
            select() {
              return this;
            },
            eq(field, value) {
              if (field === 'revision') assert.equal(value, 1);
              if (field === 'source_hash') {
                assert.equal(value, 'b'.repeat(64));
              }
              return this;
            },
            async maybeSingle() {
              state = { ...state, ...next };
              return { data: state, error: null };
            }
          };
        }
      };
    }
  };
  const repo = createSupabaseOwnerNovelBibleCheckpointRepository({
    serviceClient
  });
  assert.equal(await repo.readSnapshot({ episodeId: 11 }), null);
  const inserted = await repo.compareAndSwap({
    episodeId: 11,
    expectedRevision: null,
    expectedSourceHash: null,
    nextSourceHash: 'b'.repeat(64),
    nextSummary: { novelightPhase2: { state: 'in_progress' } }
  });
  assert.equal(inserted.revision, 1);
  const updated = await repo.compareAndSwap({
    episodeId: 11,
    expectedRevision: 1,
    expectedSourceHash: 'b'.repeat(64),
    nextSourceHash: 'c'.repeat(64),
    nextSummary: { novelightPhase2: { state: 'complete' } }
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.source_hash, 'c'.repeat(64));
  assert.deepEqual(writes.map((entry) => entry[0]), ['insert', 'update']);
});
