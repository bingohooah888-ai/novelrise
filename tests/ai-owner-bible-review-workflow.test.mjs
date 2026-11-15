import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleReviewWorkflow } from '../api/_lib/ai/owner-bible-review-workflow.js';
import { planNovelBibleEpisodeChanges } from '../api/_lib/ai/novel-bible.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a'.repeat(32);
const NOVEL = { id: 354, user_id: OWNER };
const EPISODE = {
  id: 41,
  novel_id: 354,
  title: '架空の第一話',
  content: '蒼は港で凛と再会した。凛は青い鍵を手にしていた。'
};
const HASH = planNovelBibleEpisodeChanges({
  principal: { id: OWNER },
  novel: NOVEL,
  episodes: [EPISODE],
  analyses: []
}).pending[0].sourceHash;
const SUGGESTION = {
  kind: 'character',
  key: '凛',
  summary: '港で青い鍵を持つ人物。',
  evidence: '凛は青い鍵を手にしていた。'
};
const MODEL_TEXT = JSON.stringify({ suggestions: [SUGGESTION] });

function setup(options = {}) {
  const state = {
    authCalls: 0,
    databaseCalls: [],
    records: new Map(),
    hashes: new Map(),
    attempts: 0,
    episode: { ...EPISODE },
    storedCanon: [{ kind: 'character', key: '凛' }]
  };
  const authClient = {
    auth: {
      async getUser(token) {
        state.authCalls += 1;
        return {
          data: {
            user: { id: token === TOKEN ? OWNER : OTHER }
          },
          error: null
        };
      }
    }
  };
  const serviceClient = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(field, value) {
              return {
                async maybeSingle() {
                  state.databaseCalls.push([table, columns, field, value]);
                  if (table === 'novels' && value === 354) {
                    return { data: NOVEL, error: null };
                  }
                  if (table === 'episodes' && value === 41) {
                    return { data: state.episode, error: null };
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
  const repository = {
    async listAuthorConfirmed({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      return state.storedCanon;
    },
    async savePendingBatch({
      actorId,
      novelId,
      episodeId,
      sourceHash,
      requestHash,
      candidates
    }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      assert.equal(episodeId, 41);
      const currentHash = planNovelBibleEpisodeChanges({
        principal: { id: OWNER },
        novel: NOVEL,
        episodes: [state.episode],
        analyses: []
      }).pending[0].sourceHash;
      assert.equal(sourceHash, currentHash);
      assert.equal(candidates[0].provenance, 'ai_inferred');
      assert.equal(candidates[0].requiresAuthorReview, true);
      assert.doesNotMatch(JSON.stringify(candidates), /author_confirmed/);
      state.attempts += 1;
      if (state.hashes.has(requestHash)) return { count: 0 };
      const ids = [];
      for (const candidate of candidates) {
        const id = state.records.size + 1;
        state.records.set(id, {
          id,
          novelId,
          actorId,
          sourceEpisodeId: episodeId,
          sourceHash,
          factKind: candidate.factKind,
          factKey: candidate.factKey,
          summary: candidate.factPayload.summary,
          evidence: candidate.factPayload.evidence,
          provenance: 'ai_inferred',
          status: 'pending',
          revision: 1
        });
        ids.push(id);
      }
      state.hashes.set(requestHash, ids);
      return { count: candidates.length };
    },
    async listPending({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      return [...state.records.values()]
        .filter((row) => row.status === 'pending')
        .map((row) => ({ ...row }));
    },
    async listAccepted({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      return [...state.records.values()]
        .filter((row) => row.status === 'accepted')
        .map((row) => ({ ...row }));
    },
    async readCandidate({ actorId, novelId, candidateId }) {
      const row = state.records.get(candidateId);
      if (row?.actorId !== actorId || row?.novelId !== novelId) return null;
      return { ...row };
    },
    async compareAndSwapDecision({
      actorId,
      novelId,
      candidateId,
      sourceHash,
      expectedRevision,
      expectedStatus,
      decision
    }) {
      const row = state.records.get(candidateId);
      if (
        !row ||
        row.actorId !== actorId ||
        row.novelId !== novelId ||
        row.sourceHash !== sourceHash ||
        row.revision !== expectedRevision ||
        row.status !== expectedStatus
      ) {
        return null;
      }
      row.status = decision;
      row.revision += 1;
      return { status: row.status, revision: row.revision };
    }
  };
  const workflow = createOwnerBibleReviewWorkflow({
    ownerId: OWNER,
    enabled: true,
    authClient,
    serviceClient,
    repository,
    ...options
  });
  const stage = (extra = {}) =>
    workflow.stage({
      token: TOKEN,
      novelId: 354,
      episodeId: 41,
      sourceHash: HASH,
      modelText: MODEL_TEXT,
      ...extra
    });
  const decide = (extra = {}) =>
    workflow.decide({
      token: TOKEN,
      novelId: 354,
      candidateId: 1,
      expectedRevision: 1,
      action: 'accept',
      explicitAuthorAction: true,
      ...extra
    });
  return { workflow, state, stage, decide };
}

test('04 stages only owner-verified source candidates', async () => {
  const { state, stage } = setup();
  const result = await stage();
  assert.deepEqual(result, { novelId: 354, stagedCount: 1 });
  assert.equal(state.records.size, 1);
  assert.equal(state.records.get(1).status, 'pending');
  assert.equal(state.records.get(1).provenance, 'ai_inferred');
  assert.equal(state.records.get(1).revision, 1);
  assert.equal(state.authCalls, 1);
});

test('accept reviews but never promotes author canon', async () => {
  const { state, stage, decide } = setup();
  await stage();
  const accepted = await decide();
  assert.deepEqual(accepted, {
    candidateId: 1,
    novelId: 354,
    status: 'accepted',
    revision: 2,
    canonModified: false
  });
  assert.equal(state.records.get(1).status, 'accepted');
  assert.equal(state.records.get(1).provenance, 'ai_inferred');
  assert.equal(state.storedCanon[0].key, '凛');
  await assert.rejects(decide(), /AI_OWNER_REVIEW_DENIED/);
});

test('reject is durable and non-repeatable', async () => {
  const { state, stage, decide } = setup();
  await stage();
  const result = await decide({ action: 'reject' });
  assert.equal(result.status, 'rejected');
  assert.equal(state.records.get(1).revision, 2);
  await assert.rejects(decide({ action: 'reject' }), /AI_OWNER_REVIEW_DENIED/);
});

test('disabled workflow cannot read a token, DB, or repository', async () => {
  const { workflow, state } = setup({ enabled: false });
  await assert.rejects(
    workflow.stage({
      token: TOKEN,
      novelId: 354,
      episodeId: 41,
      sourceHash: HASH,
      modelText: MODEL_TEXT
    }),
    /AI_OWNER_REVIEW_DISABLED/
  );
  assert.equal(state.authCalls, 0);
  assert.equal(state.databaseCalls.length, 0);
  assert.equal(state.attempts, 0);
});

test('reject other user before reading DB', async () => {
  const { state, stage, decide } = setup();
  await assert.rejects(
    stage({ token: 'b'.repeat(32) }),
    /AI_OWNER_REVIEW_DENIED/
  );
  await assert.rejects(
    decide({ token: 'b'.repeat(32) }),
    /AI_OWNER_REVIEW_DENIED/
  );
  assert.equal(state.databaseCalls.length, 0);
  assert.equal(state.records.size, 0);
});

test('reject foreign sources, forgeries and stale edits', async () => {
  const { state, stage } = setup();
  const changes = [
    { novelId: 99 },
    { episodeId: 99 },
    { sourceHash: '0'.repeat(64) },
    { modelText: 'not valid JSON' },
    {
      modelText: JSON.stringify({
        suggestions: [{ ...SUGGESTION, evidence: '架空の引用' }]
      })
    },
    {
      modelText: JSON.stringify({
        suggestions: [{ ...SUGGESTION, provenance: 'author_confirmed' }]
      })
    }
  ];
  for (const change of changes) {
    await assert.rejects(stage(change), /AI_/);
  }
  state.episode.content = '改稿された本文';
  await assert.rejects(stage(), /AI_BIBLE_INFERENCE_INVALID/);
  assert.equal(state.records.size, 0);
});

test('reject stale chapters, missing click and revision', async () => {
  const { state, stage, decide } = setup();
  await stage();
  await assert.rejects(
    decide({ explicitAuthorAction: false }),
    /AI_OWNER_REVIEW_DENIED/
  );
  await assert.rejects(
    decide({ expectedRevision: 4 }),
    /AI_OWNER_REVIEW_DENIED/
  );
  await assert.rejects(decide({ novelId: 100 }), /AI_OWNER_REVIEW_DENIED/);
  state.episode.content = '新しい原稿';
  await assert.rejects(decide(), /AI_BIBLE_INFERENCE_INVALID/);
  assert.equal(state.records.get(1).status, 'pending');
});

test('replay is idempotent and empty inference writes nothing', async () => {
  const { state, stage } = setup();
  await stage();
  const duplicate = await stage();
  assert.equal(duplicate.stagedCount, 0);
  assert.equal(state.records.size, 1);
  assert.equal(state.attempts, 2);
  const empty = await stage({
    modelText: JSON.stringify({ suggestions: [] })
  });
  assert.equal(empty.stagedCount, 0);
  assert.equal(state.records.size, 1);
});

test('fail closed for bad repository and settings', async () => {
  assert.throws(
    () => createOwnerBibleReviewWorkflow({ enabled: true }),
    /AI_OWNER_REVIEW_DENIED/
  );
  const { stage, state } = setup();
  state.storedCanon = [{ kind: 'made-up-kind', key: '凛' }];
  await assert.rejects(stage(), /AI_OWNER_REVIEW_DENIED/);
  assert.equal(state.records.size, 0);
});

test('owner list quarantines stale pending and accepted records without writes', async () => {
  const f = setup();
  await f.stage();
  let result = await f.workflow.list({ token: TOKEN, novelId: 354 });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.staleCandidates, []);
  assert.equal(result.candidates[0].status, 'pending');

  f.state.episode.title = '改稿された題名';
  result = await f.workflow.list({ token: TOKEN, novelId: 354 });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.acceptedCandidates, []);
  assert.equal(result.staleCandidates.length, 1);
  assert.equal(result.staleCandidates[0].status, 'pending');
  assert.equal(result.staleCandidates[0].staleReason, 'source_changed');
  await assert.rejects(f.decide(), /AI_BIBLE_INFERENCE_INVALID/u);
  assert.equal(f.state.records.get(1).status, 'pending');

  // A previously accepted suggestion is historical evidence, not author
  // canon and not eligible for a new notes transfer after source changes.
  f.state.episode.title = EPISODE.title;
  await f.decide();
  f.state.episode.content += '改稿';
  result = await f.workflow.list({ token: TOKEN, novelId: 354 });
  assert.equal(result.acceptedCandidates.length, 0);
  assert.equal(result.staleCandidates.length, 1);
  assert.equal(result.staleCandidates[0].status, 'accepted');
  assert.equal(result.staleCandidates[0].staleReason, 'source_changed');
  assert.equal(f.state.records.get(1).revision, 2);
  assert.equal(f.state.storedCanon[0].key, '凛');
});

test('missing episode stays in a read-only stale list, never auto-deleted', async () => {
  const f = setup();
  await f.stage();
  f.state.episode = null;
  const list = await f.workflow.list({ token: TOKEN, novelId: 354 });
  assert.deepEqual(list.candidates, []);
  assert.equal(list.staleCandidates.length, 1);
  assert.equal(list.staleCandidates[0].staleReason, 'episode_missing');
  assert.equal(f.state.records.get(1).status, 'pending');
  assert.equal(f.state.records.size, 1);
});

test('foreign-work episode, unauthenticated owner and malformed source reject listing', async () => {
  const f = setup();
  await f.stage();
  await assert.rejects(
    f.workflow.list({ token: 'not-a-valid-owner-token', novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
  f.state.episode.novel_id = 999;
  await assert.rejects(
    f.workflow.list({ token: TOKEN, novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
  f.state.episode.novel_id = 354;
  f.state.episode.content = null;
  await assert.rejects(
    f.workflow.list({ token: TOKEN, novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
});

test('same fact kind/key from a revised chapter is independently staged and reviewed', async () => {
  const { state, stage, decide, workflow } = setup();
  // Legacy source: explicit review is persisted but NEVER author canon.
  assert.equal((await stage()).stagedCount, 1);
  const firstRequestHash = [...state.hashes.keys()][0];
  await decide();
  assert.equal(state.records.get(1).status, 'accepted');
  assert.equal(state.storedCanon[0].key, '凛');

  // Revised source still contains the same cited passage and suggestion.
  // Its factKind+factKey are unchanged; its chapter content hash differs.
  state.episode.content += ' そして港を出発した。';
  const revisedHash = planNovelBibleEpisodeChanges({
    principal: { id: OWNER },
    novel: NOVEL,
    episodes: [state.episode],
    analyses: []
  }).pending[0].sourceHash;
  const latest = await stage({ sourceHash: revisedHash });
  assert.equal(latest.stagedCount, 1);
  assert.equal(state.hashes.size, 2);
  assert.notEqual([...state.hashes.keys()][1], firstRequestHash);
  assert.equal(state.records.size, 2);
  assert.equal(state.records.get(1).sourceHash, HASH);
  assert.equal(state.records.get(2).sourceHash, revisedHash);
  assert.equal(state.records.get(2).factKind, state.records.get(1).factKind);
  assert.equal(state.records.get(2).factKey, state.records.get(1).factKey);
  assert.equal(state.records.get(2).status, 'pending');

  // Replaying the SAME revised source must not create a third record.
  assert.equal((await stage({ sourceHash: revisedHash })).stagedCount, 0);
  assert.equal(state.records.size, 2);
  let list = await workflow.list({ token: TOKEN, novelId: 354 });
  assert.equal(list.candidates.length, 1);
  assert.equal(list.candidates[0].id, 2);
  assert.equal(list.candidates[0].replacesOutdatedVersion, true);
  assert.equal(list.staleCandidates.length, 1);
  assert.equal(list.staleCandidates[0].id, 1);
  assert.equal(list.staleCandidates[0].status, 'accepted');
  assert.equal(list.staleCandidates[0].staleReason, 'source_changed');
  assert.equal(list.acceptedCandidates.length, 0);

  // Only the NEW record is reviewable, old review history remains unchanged.
  await assert.rejects(
    decide({ candidateId: 1, expectedRevision: 2 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
  assert.equal(
    (
      await decide({
        candidateId: 2,
        expectedRevision: 1,
        action: 'accept'
      })
    ).status,
    'accepted'
  );
  list = await workflow.list({ token: TOKEN, novelId: 354 });
  assert.deepEqual(list.candidates, []);
  assert.equal(list.acceptedCandidates.length, 1);
  assert.equal(list.acceptedCandidates[0].id, 2);
  assert.equal(list.acceptedCandidates[0].replacesOutdatedVersion, true);
  assert.equal(list.staleCandidates[0].id, 1);
  assert.equal(state.records.get(1).revision, 2);
  assert.equal(state.records.get(2).revision, 2);
  assert.deepEqual(state.storedCanon, [{ kind: 'character', key: '凛' }]);
});

test('different episode or different fact key never receives false newer-version label', async () => {
  const { state, stage, workflow } = setup();
  await stage();
  state.episode.content += '追記。';
  const revisedHash = planNovelBibleEpisodeChanges({
    principal: { id: OWNER },
    novel: NOVEL,
    episodes: [state.episode],
    analyses: []
  }).pending[0].sourceHash;
  // Simulate a different key in the same revised chapter; both rows are kept.
  state.records.set(2, {
    ...state.records.get(1),
    id: 2,
    sourceHash: revisedHash,
    factKey: '別の人物',
    revision: 1
  });
  const list = await workflow.list({ token: TOKEN, novelId: 354 });
  assert.equal(list.candidates.length, 1);
  assert.equal(list.candidates[0].replacesOutdatedVersion, undefined);
  assert.equal(list.staleCandidates.length, 1);
  assert.equal(list.staleCandidates[0].id, 1);
});

test('130 mixed review candidates page newest first with all historical rows recoverable', async () => {
  const records = Array.from({ length: 130 }, (_, index) => {
    const id = index + 1;
    const status = id % 4 === 0 ? 'accepted' : 'pending';
    return {
      id,
      actorId: OWNER,
      novelId: 354,
      sourceEpisodeId: 41,
      sourceHash: id % 3 === 0 ? 'b'.repeat(64) : HASH,
      factKind: 'character',
      factKey: '凛',
      summary: '候補 ' + id,
      evidence: SUGGESTION.evidence,
      status,
      provenance: 'ai_inferred',
      revision: status === 'accepted' ? 2 : 1
    };
  });
  const reads = [];
  const repository = {
    listAuthorConfirmed: async () => [],
    savePendingBatch: async () => ({ count: 0 }),
    readCandidate: async () => null,
    compareAndSwapDecision: async () => null,
    async listReviewPage({ actorId, novelId, beforeId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      reads.push(beforeId);
      const matches = records
        .filter((row) => beforeId === null || row.id < beforeId)
        .sort((a, b) => b.id - a.id);
      return {
        rows: matches.slice(0, 25),
        nextBeforeId: matches.length > 25 ? matches[24].id : null
      };
    }
  };
  const { workflow, state } = setup({ repository });
  const ids = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await workflow.list({
      token: TOKEN,
      novelId: 354,
      beforeId: cursor
    });
    const all = [
      ...page.candidates,
      ...page.acceptedCandidates,
      ...page.staleCandidates
    ];
    assert.ok(all.length > 0 && all.length <= 25);
    assert.equal(new Set(all.map((row) => row.id)).size, all.length);
    if (pages === 0) assert.equal(Math.max(...all.map((row) => row.id)), 130);
    for (const item of page.staleCandidates) {
      assert.equal(item.staleReason, 'source_changed');
      assert.equal(item.id % 3, 0);
    }
    ids.push(...all.map((row) => row.id));
    cursor = page.pagination.nextBeforeId;
    pages += 1;
  } while (cursor !== null && pages <= 6);
  assert.equal(pages, 6);
  assert.deepEqual(
    [...ids].sort((a, b) => b - a),
    Array.from({ length: 130 }, (_, index) => 130 - index)
  );
  assert.equal(new Set(ids).size, 130);
  assert.deepEqual(reads, [null, 106, 81, 56, 31, 6]);
  assert.equal(state.records.size, 0);
});

test('page cursor and forged unordered or repeated candidate rows fail closed', async () => {
  const row = {
    id: 40,
    actorId: OWNER,
    novelId: 354,
    sourceEpisodeId: 41,
    sourceHash: HASH,
    factKind: 'character',
    factKey: '凛',
    summary: '再登場',
    evidence: SUGGESTION.evidence,
    provenance: 'ai_inferred',
    status: 'pending',
    revision: 1
  };
  const make = (rows, nextBeforeId = null) =>
    setup({
      repository: {
        listAuthorConfirmed: async () => [],
        savePendingBatch: async () => ({ count: 0 }),
        readCandidate: async () => null,
        compareAndSwapDecision: async () => null,
        listReviewPage: async () => ({ rows, nextBeforeId })
      }
    }).workflow;
  for (const rows of [
    [row, row],
    [{ ...row, id: 39 }, row],
    [{ ...row, status: 'rejected' }],
    [{ ...row, novelId: 999 }],
    [{ ...row, actorId: OTHER }],
    [{ ...row, id: 41 }]
  ]) {
    await assert.rejects(
      make(rows).list({ token: TOKEN, novelId: 354, beforeId: 41 }),
      /AI_OWNER_REVIEW_DENIED/u
    );
  }
  await assert.rejects(
    make([row], 40).list({ token: TOKEN, novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
  await assert.rejects(
    make([]).list({ token: OTHER, novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/u
  );
});
