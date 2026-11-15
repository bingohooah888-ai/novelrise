import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { createOfflineOwnerNovelBibleCheckpoint } from '../api/_lib/ai/owner-novel-bible-checkpoint.js';
import { createOwnerNovelBibleModelBridge } from '../api/_lib/ai/owner-novel-bible-model-bridge.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic.jwt.not-a-real-token-12345';
const CONTENT = '凛は青い鍵を持っていた。';

function fixture(overrides = {}) {
  const state = {
    owner: OWNER,
    novelId: 41,
    episodeId: 11,
    title: '第一話',
    content: CONTENT,
    consent: true,
    authCalls: 0,
    consentCalls: 0,
    modelCalls: 0,
    reviewCalls: 0,
    prompt: null
  };
  Object.assign(state, overrides);
  const authClient = {
    auth: {
      async getUser() {
        state.authCalls += 1;
        return { data: { user: { id: state.owner } }, error: null };
      }
    }
  };
  const serviceClient = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === 'novels') {
            return {
              data: { id: state.novelId, user_id: OWNER },
              error: null
            };
          }
          if (table === 'episodes') {
            return {
              data: {
                id: state.episodeId,
                novel_id: state.novelId,
                title: state.title,
                content: state.content
              },
              error: null
            };
          }
          throw new Error('Unexpected table');
        }
      };
    }
  };
  const aiRouter = {
    async run(options) {
      state.modelCalls += 1;
      state.prompt = options;
      const chunk = JSON.parse(options.user).untrusted_excerpt;
      return {
        text: JSON.stringify({
          suggestions: [
            {
              kind: 'character',
              key: '凛',
              summary: '青い鍵を持つ。',
              evidence: chunk
            }
          ]
        })
      };
    }
  };
  const reviewWorkflow = {
    async stage(options) {
      state.reviewCalls += 1;
      state.reviewInput = options;
      return { novelId: 41, stagedCount: 1 };
    }
  };
  const permissionCheck = async () => {
    state.consentCalls += 1;
    return state.consent;
  };
  function make(config = {}) {
    return createOwnerNovelBibleModelBridge({
      enabled: true,
      externalProcessingApproved: true,
      ownerId: OWNER,
      authClient,
      serviceClient,
      aiRouter,
      reviewWorkflow,
      permissionCheck,
      ...config
    });
  }
  return { state, make };
}

test('disabled configuration refuses model calls', async () => {
  const { state, make } = fixture();
  await assert.rejects(
    make({ enabled: false }).stage({
      token: TOKEN,
      novelId: 41,
      episodeId: 11
    }),
    /AI_BIBLE_MODEL_BRIDGE_DISABLED/u
  );
  await assert.rejects(
    make({ externalProcessingApproved: false }).stage({
      token: TOKEN,
      novelId: 41,
      episodeId: 11
    }),
    /AI_BIBLE_MODEL_BRIDGE_DISABLED/u
  );
  assert.equal(state.authCalls, 0);
  assert.equal(state.modelCalls, 0);
});

test('owner mock stages a validated private excerpt', async () => {
  const { state, make } = fixture();
  const answer = await make().stage({
    token: TOKEN,
    novelId: 41,
    episodeId: 11
  });
  assert.deepEqual(answer, {
    novelId: 41,
    stagedCount: 1,
    requiresAuthorReview: true
  });
  assert.equal(state.authCalls, 2);
  assert.equal(state.consentCalls, 2);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 1);
  assert.equal(state.prompt.featureKey, 'novel-bible');
  assert.equal(state.prompt.principal.id, OWNER);
  assert.equal(state.prompt.workId, 41);
  assert.match(state.prompt.revision, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.parse(state.prompt.user).untrusted_excerpt, CONTENT);
  assert.equal(state.reviewInput.novelId, 41);
  assert.match(state.reviewInput.sourceHash, /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(answer).includes(CONTENT));
  assert.ok(!JSON.stringify(answer).includes(TOKEN));
});

test('outsiders and wrong works are rejected before provider', async () => {
  const outsider = fixture({ owner: OTHER });
  await assert.rejects(
    outsider.make().stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(outsider.state.modelCalls, 0);
  const wrongWork = fixture({ novelId: 99 });
  await assert.rejects(
    wrongWork.make().stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(wrongWork.state.modelCalls, 0);
  const wrongChapter = fixture({ episodeId: 99 });
  await assert.rejects(
    wrongChapter.make().stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(wrongChapter.state.modelCalls, 0);
});

test('unapproved and revoked consent stop model and persistence', async () => {
  const blocked = fixture({ consent: false });
  await assert.rejects(
    blocked.make().stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(blocked.state.modelCalls, 0);
  const revoked = fixture();
  const bridge = revoked.make({
    aiRouter: {
      async run() {
        revoked.state.modelCalls += 1;
        revoked.state.consent = false;
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(revoked.state.reviewCalls, 0);
  assert.equal(revoked.state.modelCalls, 1);
});

test('manuscript revisions during provider call fail closed', async () => {
  const { state, make } = fixture();
  const bridge = make({
    aiRouter: {
      async run() {
        state.modelCalls += 1;
        state.content = '改稿後の別の文章。';
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_CHUNK_INVALID|AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(state.reviewCalls, 0);
});

test('model evidence outside the requested chunk is blocked', async () => {
  const { state, make } = fixture({
    content: '凛は青い鍵を持っていた。'.repeat(250)
  });
  const bridge = make({
    aiRouter: {
      async run() {
        state.modelCalls += 1;
        return {
          text: JSON.stringify({
            suggestions: [
              {
                kind: 'character',
                key: '凛',
                summary: '別の章を参照する。',
                evidence: '存在しない引用'
              }
            ]
          })
        };
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_INFERENCE_INVALID/u
  );
  assert.equal(state.reviewCalls, 0);
});

test('bad JWT and chunk reject before provider', async () => {
  const { state, make } = fixture();
  for (const args of [
    { token: 'short', novelId: 41, episodeId: 11 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: -1 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: 64 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: 9 }
  ]) {
    await assert.rejects(make().stage(args), /AI_BIBLE_MODEL_BRIDGE_DENIED/u);
  }
  assert.equal(state.modelCalls, 0);
});

test('dormant bridge is not imported by existing public API routes', () => {
  for (const path of [
    '../api/ai-owner-bible-review.js',
    '../api/_lib/ai/owner-novel-bible-preview.js'
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /owner-novel-bible-model-bridge/u);
  }
  const source = readFileSync(
    new URL(
      '../api/_lib/ai/owner-novel-bible-model-bridge.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /(?:fetch\(|process\.env)/u);
  assert.doesNotMatch(source, /create(?:OpenAi|Gemini)TextProvider/u);
  assert.match(source, /externalProcessingApproved !== true/u);
  assert.match(source, /permissionCheck/u);
  assert.match(source, /reviewWorkflow\.stage/u);
});

test('02-07-05 post-model session change refuses candidate persistence', async () => {
  const { state, make } = fixture();
  const bridge = make({
    aiRouter: {
      async run() {
        state.modelCalls += 1;
        state.owner = OTHER;
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 0);
  assert.equal(state.authCalls, 2);
});

test('02-07-05 post-model episode transfer refuses stale candidate', async () => {
  const { state, make } = fixture();
  const bridge = make({
    aiRouter: {
      async run() {
        state.modelCalls += 1;
        state.episodeId = 12;
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 0);
});

test('02-07-05 verified prior manuscript sends changed excerpt only, then saves pending review', async () => {
  const oldText = '凛は赤い鍵を持っていた。';
  const checkpoint = {
    analysis: {
      episode_id: 11,
      source_hash: createHash('sha256')
        .update(JSON.stringify(['第一話', oldText]))
        .digest('hex')
    },
    episode: {
      id: 11,
      novel_id: 41,
      title: '第一話',
      content: oldText
    }
  };
  const { state, make } = fixture();
  let reads = 0;
  const bridge = make({
    readVerifiedHistory: async ({ actorId, novelId, episodeId }) => {
      reads += 1;
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 41);
      assert.equal(episodeId, 11);
      return checkpoint;
    }
  });
  const result = await bridge.stage({
    token: TOKEN,
    novelId: 41,
    episodeId: 11
  });
  assert.equal(result.stagedCount, 1);
  assert.equal(reads, 2);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 1);
  assert.equal(JSON.parse(state.prompt.user).untrusted_excerpt, '青');
  assert.equal(state.reviewInput.modelText.includes('青'), true);
  assert.equal(state.reviewInput.sourceHash.length, 64);
  assert.ok(!JSON.stringify(state.prompt).includes(oldText));
  assert.ok(!JSON.stringify(result).includes(CONTENT));
});

test('02-07-05 invalid trusted historical revisions fail before any paid call', async () => {
  const { state, make } = fixture();
  for (const historical of [
    { analysis: { episode_id: 12, source_hash: '0'.repeat(64) } },
    {
      analysis: { episode_id: 11, source_hash: '0'.repeat(64) },
      episode: {
        id: 11,
        novel_id: 99,
        title: '第一話',
        content: '別作品'
      }
    },
    { analysis: { episode_id: 11, source_hash: 'not-a-hash' } }
  ]) {
    await assert.rejects(
      make({ readVerifiedHistory: async () => historical }).stage({
        token: TOKEN,
        novelId: 41,
        episodeId: 11
      }),
      /AI_BIBLE_MODEL_BRIDGE_DENIED|AI_BIBLE_CHUNK_INVALID/u
    );
  }
  assert.equal(state.modelCalls, 0);
  assert.equal(state.reviewCalls, 0);
});

test('02-07-05 identical or deletion-only revisions do not spend AI budget', async () => {
  for (const [before, after] of [
    ['凛は青い鍵を持っていた。', '凛は青い鍵を持っていた。'],
    ['凛は青い鍵を持っていた。', '凛は鍵を持っていた。']
  ]) {
    const { state, make } = fixture({ content: after });
    const checkpoint = {
      analysis: {
        episode_id: 11,
        source_hash: createHash('sha256')
          .update(JSON.stringify(['第一話', before]))
          .digest('hex')
      },
      episode: { id: 11, novel_id: 41, title: '第一話', content: before }
    };
    const result = await make({
      readVerifiedHistory: async () => checkpoint
    }).stage({ token: TOKEN, novelId: 41, episodeId: 11 });
    assert.deepEqual(result, {
      novelId: 41,
      stagedCount: 0,
      requiresAuthorReview: false
    });
    assert.equal(state.modelCalls, 0);
    assert.equal(state.reviewCalls, 0);
  }
});

test('02-07-05 history changed during provider response refuses review persistence', async () => {
  const { state, make } = fixture();
  const before = '凛は赤い鍵を持っていた。';
  const historicalHash = createHash('sha256')
    .update(JSON.stringify(['第一話', before]))
    .digest('hex');
  let reads = 0;
  const bridge = make({
    readVerifiedHistory: async () => {
      reads += 1;
      return {
        analysis: { episode_id: 11, source_hash: historicalHash },
        episode: {
          id: 11,
          novel_id: 41,
          title: '第一話',
          content: reads === 1 ? before : '凛は緑の鍵を持っていた。'
        }
      };
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(reads, 2);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 0);
});

test('02-07-05 one-call bridge resumes confirmed chunks without repeated AI expense', async () => {
  const { state, make } = fixture({ content: '青'.repeat(3100) });
  let row = null;
  let recorded = 0;
  const repository = {
    async readSnapshot() {
      return row === null ? null : structuredClone(row);
    },
    async compareAndSwap(change) {
      recorded += 1;
      if (
        change.expectedRevision !== (row?.revision ?? null) ||
        change.expectedSourceHash !== (row?.source_hash ?? null)
      ) {
        return null;
      }
      row = {
        episode_id: 11,
        source_hash: change.nextSourceHash,
        summary: structuredClone(change.nextSummary),
        revision: (row?.revision ?? 0) + 1
      };
      return structuredClone(row);
    }
  };
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository
  });
  const bridge = make({
    checkpoint,
    aiRouter: {
      async run() {
        state.modelCalls += 1;
        return { text: '{"suggestions":[]}' };
      }
    },
    reviewWorkflow: {
      async stage() {
        state.reviewCalls += 1;
        return { novelId: 41, stagedCount: 0 };
      }
    }
  });
  const run = (chunkIndex) =>
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11, chunkIndex });

  assert.equal((await run(0)).requiresAuthorReview, true);
  assert.equal(recorded, 1);
  assert.equal(row.summary.novelightPhase2.state, 'in_progress');
  assert.equal(state.modelCalls, 1);
  assert.deepEqual(await run(0), {
    novelId: 41,
    stagedCount: 0,
    requiresAuthorReview: false
  });
  assert.equal(state.modelCalls, 1);
  assert.equal(recorded, 1);

  // Each request handles exactly one chunk: no automatic provider loop.
  assert.equal((await run(1)).requiresAuthorReview, true);
  assert.equal((await run(2)).requiresAuthorReview, true);
  assert.equal(state.modelCalls, 3);
  assert.equal(state.reviewCalls, 3);
  assert.equal(recorded, 3);
  assert.equal(row.summary.novelightPhase2.state, 'complete');
  assert.deepEqual(await run(2), {
    novelId: 41,
    stagedCount: 0,
    requiresAuthorReview: false
  });
  assert.equal(state.modelCalls, 3);
});

test('02-07-05 failed candidate staging never acknowledges a paid chunk', async () => {
  const { state, make } = fixture();
  let journalCalls = 0;
  const bridge = make({
    checkpoint: {
      async inspect() {
        return 'pending';
      },
      async record() {
        journalCalls += 1;
        return { complete: true, alreadyRecorded: false, remainingChunks: 0 };
      }
    },
    reviewWorkflow: {
      async stage() {
        state.reviewCalls += 1;
        throw new Error('SYNTHETIC_PENDING_WRITE_FAILURE');
      }
    }
  });
  await assert.rejects(
    bridge.stage({ token: TOKEN, novelId: 41, episodeId: 11 }),
    /SYNTHETIC_PENDING_WRITE_FAILURE/u
  );
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reviewCalls, 1);
  assert.equal(journalCalls, 0);
});
