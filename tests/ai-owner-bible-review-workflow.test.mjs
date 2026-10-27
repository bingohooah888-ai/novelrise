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
      assert.equal(sourceHash, HASH);
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
    async readCandidate({ actorId, novelId, candidateId }) {
      const row = state.records.get(candidateId);
      if (row?.actorId !== actorId || row?.novelId !== novelId) return null;
      return structuredClone(row);
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
