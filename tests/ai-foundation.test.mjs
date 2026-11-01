import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_FEATURES,
  APPROVED_AI_FEATURE_COUNT,
  requireAiFeature
} from '../api/_lib/ai/registry.js';
import { projectAiWorkContext, makeAiPrompt } from '../api/_lib/ai/context.js';
import { createAiRouter } from '../api/_lib/ai/router.js';
import {
  createGeminiTextProvider,
  createOpenAiTextProvider
} from '../api/_lib/ai/providers.js';

const USER = { id: 'author-1' };
const NOVEL = {
  id: 41,
  user_id: 'author-1',
  title: 'TEST',
  publiclyVisible: true
};

function fakeRouter(overrides = {}) {
  const state = { calls: 0, reserves: [], settlements: [], audits: [] };
  const providers = {
    mock: {
      async generate() {
        state.calls += 1;
        return {
          text: 'Improvement suggestion',
          usage: { inputTokens: 20, outputTokens: 10 }
        };
      }
    }
  };
  const budget = {
    async reserve(entry) {
      state.reserves.push(entry);
      return { id: 'reservation-1' };
    },
    async settle(entry) {
      state.settlements.push(entry);
    }
  };
  const audit = {
    async record(entry) {
      state.audits.push(entry);
    }
  };
  const cacheEntries = new Map();
  const cache = {
    async get(key) {
      return cacheEntries.get(key);
    },
    async set(key, value) {
      cacheEntries.set(key, value);
    }
  };
  const router = createAiRouter({
    authorize: async () => true,
    budget,
    audit,
    providers,
    routes: {
      light: [
        {
          provider: 'mock',
          model: 'mock-tiny',
          inputMicrosPerMillion: 100000,
          outputMicrosPerMillion: 400000,
          maxOutputTokens: 100
        }
      ]
    },
    cache,
    enabled: true,
    ...overrides
  });
  return { router, state };
}

const REQUEST = {
  featureKey: 'prepublish-check',
  principal: USER,
  workId: NOVEL.id,
  revision: 'rev-a',
  system: 'Give short feedback',
  user: 'Episode text'
};

test('approved scope is exactly 33 capabilities, excluding deferred categories', () => {
  assert.equal(APPROVED_AI_FEATURE_COUNT, 33);
  assert.equal(Object.keys(AI_FEATURES).length, 33);
  for (const id of [24, 25, 30]) {
    assert.equal(
      Object.values(AI_FEATURES).some((entry) => entry.id === id),
      false
    );
  }
  assert.equal(requireAiFeature('art-generation').id, 36);
  assert.throws(() => requireAiFeature('__proto__'), /AI_FEATURE_NOT_APPROVED/);
});

test('author-only private notes are never projected into reader context', () => {
  const context = projectAiWorkContext({
    principal: { id: 'reader-1' },
    novel: NOVEL,
    audience: 'reader',
    episodes: [
      {
        id: 10,
        status: 'published',
        order_index: 1,
        title: 'First',
        content: 'Known detail'
      },
      {
        id: 11,
        status: 'published',
        order_index: 2,
        title: 'Second',
        content: 'Future revelation'
      },
      {
        id: 12,
        status: 'draft',
        order_index: 3,
        title: 'Draft',
        content: 'Author secret'
      }
    ],
    progress: { completedEpisodeIds: [10, 12] },
    authorNotes: [{ body: 'Secret world notes' }]
  });
  const serialized = JSON.stringify(context);
  assert.match(serialized, /Known detail/);
  assert.doesNotMatch(
    serialized,
    /Future revelation|Author secret|Secret world notes/
  );
  assert.equal(context.episodes.length, 1);
  assert.ok(!Object.hasOwn(context, 'privateNotes'));
  assert.match(
    makeAiPrompt({ context, instruction: '感想を教えて' }).system,
    /later plot/
  );
});

test('unknown progress, unpublished title, future scheduling are fail-closed', () => {
  const novels = [
    {
      id: 1,
      status: 'published',
      published_at: '2099-01-01T00:00:00Z',
      content: 'scheduled'
    }
  ];
  const empty = projectAiWorkContext({
    principal: { id: 'reader-1' },
    novel: NOVEL,
    audience: 'reader',
    episodes: novels,
    progress: null
  });
  assert.deepEqual(empty.episodes, []);
  const hidden = projectAiWorkContext({
    principal: { id: 'reader-1' },
    novel: NOVEL,
    audience: 'reader',
    episodes: novels,
    progress: { completedEpisodeIds: [1] },
    now: new Date('2026-10-27T00:00:00Z')
  });
  assert.deepEqual(hidden.episodes, []);
  assert.throws(
    () =>
      projectAiWorkContext({
        principal: { id: 'other-author' },
        novel: NOVEL,
        audience: 'author',
        episodes: []
      }),
    /AI_ACCESS_DENIED/
  );
});

test('author projection includes private notes only for the verified owner', () => {
  const result = projectAiWorkContext({
    principal: USER,
    novel: NOVEL,
    audience: 'author',
    episodes: [{ id: 9, status: 'draft', title: 'Pending', content: 'Draft' }],
    authorNotes: [{ title: 'World', note_type: 'world', body: 'Hidden lore' }]
  });
  assert.match(JSON.stringify(result.privateNotes), /Hidden lore/);
});

test('router is disabled unless explicitly activated and has durable backends', async () => {
  assert.throws(
    () => createAiRouter({ enabled: true }),
    /AI_SECURITY_BACKEND_REQUIRED/
  );
  const disabled = fakeRouter({ enabled: false });
  await assert.rejects(disabled.router.run(REQUEST), /AI_DISABLED/);
  assert.equal(disabled.state.calls, 0);
});

test('authorization is checked before even a cache read', async () => {
  let cacheReads = 0;
  const { router, state } = fakeRouter({
    authorize: async () => false,
    cache: {
      async get() {
        cacheReads += 1;
        return { text: 'leaked' };
      }
    }
  });
  await assert.rejects(router.run(REQUEST), /AI_ACCESS_DENIED/);
  assert.equal(cacheReads, 0);
  assert.equal(state.calls, 0);
});

test('budget denial prevents external provider invocation', async () => {
  const { router, state } = fakeRouter({
    budget: {
      async reserve() {
        return null;
      },
      async settle() {
        throw new Error('must not settle');
      }
    }
  });
  await assert.rejects(router.run(REQUEST), /AI_BUDGET_DENIED/);
  assert.equal(state.calls, 0);
});

test('result cache is scoped to identity, revision, work and reader progress', async () => {
  const { router, state } = fakeRouter();
  const first = await router.run(REQUEST);
  const cached = await router.run(REQUEST);
  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(state.calls, 1);
  assert.equal(state.reserves.length, 1);
  assert.equal(state.settlements.length, 1);
  await router.run({ ...REQUEST, revision: 'rev-b' });
  await router.run({ ...REQUEST, readerScope: 'read-through-4' });
  await router.run({ ...REQUEST, principal: { id: 'author-2' } });
  assert.equal(state.calls, 4);
  assert.ok(state.reserves.every((entry) => entry.ceilingMicros > 0));
  assert.equal(state.audits.filter((entry) => entry.cacheHit).length, 1);
});

test('provider fallback requires a retryable error and reserves both attempts', async () => {
  const { router, state } = fakeRouter({
    providers: {
      first: {
        async generate() {
          state.calls += 1;
          throw Object.assign(new Error('timeout'), { retryable: true });
        }
      },
      second: {
        async generate() {
          state.calls += 1;
          return {
            text: 'fallback',
            usage: { inputTokens: 20, outputTokens: 10 }
          };
        }
      }
    },
    routes: {
      light: ['first', 'second'].map((provider) => ({
        provider,
        model: 'safe-model',
        inputMicrosPerMillion: 100000,
        outputMicrosPerMillion: 400000,
        maxOutputTokens: 100
      }))
    }
  });
  const result = await router.run(REQUEST);
  assert.equal(result.provider, 'second');
  assert.equal(state.calls, 2);
  assert.equal(state.settlements.length, 1);
  assert.ok(state.settlements[0].chargedMicros > 0);
});

test('non-retryable provider errors never fall back', async () => {
  const { router, state } = fakeRouter({
    providers: {
      first: {
        async generate() {
          state.calls += 1;
          throw Object.assign(new Error('policy'), { retryable: false });
        }
      },
      second: {
        async generate() {
          state.calls += 1;
          return { text: 'never used' };
        }
      }
    },
    routes: {
      light: ['first', 'second'].map((provider) => ({
        provider,
        model: 'safe-model',
        inputMicrosPerMillion: 100000,
        outputMicrosPerMillion: 400000,
        maxOutputTokens: 100
      }))
    }
  });
  await assert.rejects(router.run(REQUEST), /AI_PROVIDER_UNAVAILABLE/);
  assert.equal(state.calls, 1);
  assert.equal(state.settlements.length, 1);
});

test('providers parse usage without touching the live network', async () => {
  let observed;
  const mockFetch = async (url, options) => {
    observed = { url, options };
    return {
      ok: true,
      async json() {
        return url.includes('openai')
          ? {
              output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
              usage: { input_tokens: 12, output_tokens: 6 }
            }
          : {
              candidates: [{ content: { parts: [{ text: 'yes' }] } }],
              usageMetadata: {
                promptTokenCount: 15,
                candidatesTokenCount: 7
              }
            };
      }
    };
  };
  const openai = createOpenAiTextProvider({
    apiKey: 'test-not-real',
    fetchImpl: mockFetch
  });
  const result = await openai.generate({
    model: 'mock-model',
    system: 'system',
    user: 'user',
    maxOutputTokens: 30,
    timeoutMs: 1000
  });
  assert.equal(result.usage.inputTokens, 12);
  assert.equal(JSON.parse(observed.options.body).store, false);

  const gemini = createGeminiTextProvider({
    apiKey: 'test-not-real',
    fetchImpl: mockFetch
  });
  const output = await gemini.generate({
    model: 'mock-model',
    system: 'system',
    user: 'user',
    maxOutputTokens: 30,
    timeoutMs: 1000
  });
  assert.equal(output.text, 'yes');
  assert.equal(output.usage.outputTokens, 7);
});

test('02-07-05 failed attempt plus unknown usage settles full fallback ceiling once', async () => {
  const routes = ['first', 'second'].map((provider) => ({
    provider,
    model: 'synthetic-offline',
    inputMicrosPerMillion: 1000000,
    outputMicrosPerMillion: 2000000,
    maxOutputTokens: 128
  }));
  const { router, state } = fakeRouter({
    routes: { light: routes },
    providers: {
      first: {
        async generate() {
          state.calls += 1;
          throw Object.assign(new Error('synthetic timeout'), {
            retryable: true
          });
        }
      },
      second: {
        async generate() {
          state.calls += 1;
          return { text: 'synthetic result', usage: null };
        }
      }
    }
  });
  const response = await router.run(REQUEST);
  assert.equal(response.provider, 'second');
  assert.equal(state.calls, 2);
  assert.equal(state.reserves.length, 1);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(
    state.settlements[0].chargedMicros,
    state.reserves[0].ceilingMicros
  );
  assert.equal(state.audits[0].chargedMicros, state.reserves[0].ceilingMicros);
  assert.equal(state.audits[0].outcome, 'success');
  assert.ok(!JSON.stringify(state.audits).includes(REQUEST.user));
});
