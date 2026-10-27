import assert from 'node:assert/strict';
import test from 'node:test';

import { createOfflineNovelBibleTrial } from '../api/_lib/ai/owner-novel-bible-mock-trial.js';
import '../novelight-ai-bible-owner-panel.js';
import { planNovelBibleEpisodeChanges } from '../api/_lib/ai/novel-bible.js';

const OWNER = 'mock-owner';
const principal = { id: OWNER };
const novel = { id: 41, user_id: OWNER };
const other = {
  id: 10,
  novel_id: 41,
  title: '第一話',
  content: 'KEEP_UNPUBLISHED_SECRET'
};
const changed = {
  id: 11,
  novel_id: 41,
  title: '第二話',
  content: '凛は青い鍵を持っていた。'
};

function fixture(overrides = {}) {
  const hash = planNovelBibleEpisodeChanges({
    principal,
    novel,
    episodes: [other],
    analyses: []
  }).pending[0].sourceHash;
  return {
    synthetic: true,
    novel,
    episodes: [other, changed],
    analyses: [{ episode_id: 10, source_hash: hash }],
    authorConfirmedFacts: [{ kind: 'character', key: '凛' }],
    ...overrides
  };
}

function trial(overrides = {}) {
  const state = { reads: 0, prompts: [], calls: 0 };
  const factory = createOfflineNovelBibleTrial({
    ownerId: OWNER,
    enabled: true,
    async loadSyntheticFixture() {
      state.reads += 1;
      return fixture();
    },
    async mockGenerate(prompt) {
      state.calls += 1;
      state.prompts.push(prompt);
      return JSON.stringify({
        suggestions: [
          {
            kind: 'character',
            key: '凛',
            summary: '青い鍵を持っていた。',
            evidence: '凛は青い鍵を持っていた。'
          }
        ]
      });
    },
    ...overrides
  });
  return { factory, state };
}

test('04 mock runs changed excerpts end to end and preserves author canon', async () => {
  const { factory, state } = trial();
  const result = await factory.preview({ principal, novelId: 41 });
  assert.equal(result.novelId, 41);
  assert.equal(result.mockOnly, true);
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(result.unchangedEpisodes, 1);
  assert.equal(result.processedChunks, 1);
  assert.equal(result.deferredChunks, 0);
  assert.equal(state.calls, 1);
  assert.equal(state.reads, 2);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.provenance, 'ai_inferred');
  assert.equal(candidate.requiresAuthorReview, true);
  assert.equal(candidate.conflictsWithAuthorCanon, true);
  assert.equal(candidate.sourceEpisodeId, 11);
  assert.match(candidate.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(candidate.chunkHash, /^[a-f0-9]{64}$/);
  assert.ok(!Object.hasOwn(candidate, 'writeAction'));
  const prompt = JSON.stringify(state.prompts);
  assert.match(prompt, /凛は青い鍵/);
  assert.doesNotMatch(prompt, /KEEP_UNPUBLISHED_SECRET/);
});

test('global OFF denies before reading or generating any manuscript', async () => {
  let reads = 0;
  const factory = createOfflineNovelBibleTrial({
    enabled: false,
    ownerId: OWNER,
    async loadSyntheticFixture() {
      reads += 1;
    },
    async mockGenerate() {
      throw new Error('must never execute');
    }
  });
  await assert.rejects(factory.preview({ principal, novelId: 41 }), /DISABLED/);
  assert.equal(reads, 0);
});

test('other actors, actual live records and incomplete dependencies are denied', async () => {
  const { factory, state } = trial();
  await assert.rejects(
    factory.preview({ principal: { id: 'other' }, novelId: 41 }),
    /TRIAL_DENIED/
  );
  const actualRows = trial({
    async loadSyntheticFixture() {
      return fixture({ synthetic: false });
    }
  });
  await assert.rejects(
    actualRows.factory.preview({ principal, novelId: 41 }),
    /TRIAL_DENIED/
  );
  const wrongWork = trial({
    async loadSyntheticFixture() {
      return fixture({ novel: { id: 42, user_id: OWNER } });
    }
  });
  await assert.rejects(
    wrongWork.factory.preview({ principal, novelId: 41 }),
    /TRIAL_DENIED/
  );
  await assert.rejects(
    factory.preview({ principal, novelId: 0 }),
    /TRIAL_DENIED/
  );
  assert.equal(state.calls, 0);
});

test('stale source after mock generation cannot return partial results', async () => {
  let reads = 0;
  const { factory } = trial({
    async loadSyntheticFixture() {
      reads += 1;
      return reads === 1
        ? fixture()
        : fixture({
            episodes: [other, { ...changed, content: '改稿された別本文' }]
          });
    }
  });
  await assert.rejects(
    factory.preview({ principal, novelId: 41 }),
    /AI_BIBLE_CHUNK_INVALID/
  );
  assert.equal(reads, 2);
});

test('forged quotes and extra model metadata fail closed', async () => {
  for (const modelText of [
    JSON.stringify({
      suggestions: [
        {
          kind: 'character',
          key: '凛',
          summary: '青い鍵を持っていた。',
          evidence: '原稿に存在しない引用'
        }
      ]
    }),
    JSON.stringify({
      suggestions: [
        {
          kind: 'character',
          key: '凛',
          summary: '青い鍵を持っていた。',
          evidence: '凛は青い鍵を持っていた。',
          provenance: 'author_confirmed'
        }
      ]
    })
  ]) {
    const { factory } = trial({
      async mockGenerate() {
        return modelText;
      }
    });
    await assert.rejects(
      factory.preview({ principal, novelId: 41 }),
      /AI_BIBLE_INFERENCE_INVALID/
    );
  }
});

test('generated quotes must occur in the selected chunk, not elsewhere', async () => {
  const text = 'あ'.repeat(1600) + '他の部分だけに書かれた秘密';
  const { factory } = trial({
    async loadSyntheticFixture() {
      return fixture({
        episodes: [other, { ...changed, content: text }],
        authorConfirmedFacts: []
      });
    },
    async mockGenerate() {
      return JSON.stringify({
        suggestions: [
          {
            kind: 'world',
            key: '秘密',
            summary: '別の断片',
            evidence: '他の部分だけに書かれた秘密'
          }
        ]
      });
    }
  });
  await assert.rejects(
    factory.preview({ principal, novelId: 41, maxChunks: 1 }),
    /TRIAL_DENIED/
  );
});

test('mock is bounded to three chunks and cannot mutate source data', async () => {
  const text = '凛と蒼が会話した。'.repeat(700);
  const source = fixture({
    episodes: [other, { ...changed, content: text }],
    authorConfirmedFacts: []
  });
  const before = JSON.stringify(source);
  let reads = 0;
  const { factory } = trial({
    async loadSyntheticFixture() {
      reads += 1;
      return source;
    },
    async mockGenerate({ user }) {
      const value = JSON.parse(user);
      return JSON.stringify({
        suggestions: [
          {
            kind: 'event',
            key: '再会',
            summary: '人物が会話した',
            evidence: value.untrusted_excerpt.slice(0, 6)
          }
        ]
      });
    }
  });
  const result = await factory.preview({
    principal,
    novelId: 41,
    maxChunks: 2
  });
  assert.equal(result.processedChunks, 2);
  assert.ok(result.deferredChunks > 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(JSON.stringify(source), before);
  assert.equal(reads, 2);
  await assert.rejects(
    factory.preview({ principal, novelId: 41, maxChunks: 4 }),
    /TRIAL_DENIED/
  );
});


test('model JSON passes chunk validation and reaches private text-only UI', async () => {
  const { factory } = trial();
  const result = await factory.preview({ principal, novelId: 41 });
  const target = { textContent: '', hidden: true };
  const accepted = globalThis.NovelightAiBibleOwnerPanel.renderMockReview({
    target,
    payload: result
  });
  assert.equal(accepted, true);
  assert.equal(target.hidden, false);
  assert.match(target.textContent, /架空データのみ/);
  assert.match(target.textContent, /凛は青い鍵を持っていた/);
  assert.match(target.textContent, /作者の確定設定と重複/);
  assert.doesNotMatch(target.textContent, /KEEP_UNPUBLISHED_SECRET/);
});


/* NOVELIGHT_04_PRETTIER_DIAGNOSTIC_TEMP */
test('emit exact Prettier layout for 04 candidate and owner panel tests', async () => {
  const { readFile } = await import('node:fs/promises');
  const prettier = await import('prettier');
  const files = [
    'tests/ai-owner-bible-mock-trial.test.mjs',
    'tests/ai-owner-bible-panel.test.mjs'
  ];
  for (const filename of files) {
    const original = await readFile(filename, 'utf8');
    const cleaned = original.split('/* NOVELIGHT_04_PRETTIER_DIAGNOSTIC_TEMP */')[0];
    const config = await prettier.resolveConfig(filename);
    const result = await prettier.format(cleaned, {
      ...config,
      filepath: filename
    });
    const label = filename.includes('mock-trial') ? 'MOCK' : 'PANEL';
    console.log('FORMAT_04_' + label + '_BEGIN' + encodeURIComponent(result) + 'FORMAT_04_' + label + '_END');
  }
});
