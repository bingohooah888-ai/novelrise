import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createOwnerNovelBibleModelBridge
} from '../api/_lib/ai/owner-novel-bible-model-bridge.js';

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

test('owner mock stages validated excerpt without exposing manuscript', async () => {
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
  assert.equal(
    JSON.parse(state.prompt.user).untrusted_excerpt,
    CONTENT
  );
  assert.equal(state.reviewInput.novelId, 41);
  assert.match(state.reviewInput.sourceHash, /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(answer).includes(CONTENT));
  assert.ok(!JSON.stringify(answer).includes(TOKEN));
});

test('other user and wrong work are rejected before provider calls', async () => {
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

test('invalid JWT and chunk position fail before model invocation', async () => {
  const { state, make } = fixture();
  for (const args of [
    { token: 'short', novelId: 41, episodeId: 11 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: -1 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: 64 },
    { token: TOKEN, novelId: 41, episodeId: 11, chunkIndex: 9 }
  ]) {
    await assert.rejects(
      make().stage(args),
      /AI_BIBLE_MODEL_BRIDGE_DENIED/u
    );
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
  assert.doesNotMatch(
    source,
    /(?:fetch\(|createOpenAiTextProvider|createGeminiTextProvider|process\.env)/u
  );
  assert.match(source, /externalProcessingApproved !== true/u);
  assert.match(source, /permissionCheck/u);
  assert.match(source, /reviewWorkflow\.stage/u);
});
