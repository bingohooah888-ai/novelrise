import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareOfflineEvidencePrompt,
  reviewOfflineEvidenceResponse
} from '../api/_lib/ai/offline-evidence-review.js';

const row = {
  id: 11,
  novel_id: 1,
  title: '第一話',
  content: '凛は青い鍵を持っていた。',
  status: 'published',
  publiclyVisible: true,
  order_index: 1
};
const second = {
  ...row,
  id: 12,
  title: '第二話',
  content: '凛は赤い鍵を見つけた。',
  order_index: 2
};
const third = {
  ...row,
  id: 13,
  title: 'UNREAD_TITLE',
  content: 'UNREAD_BODY',
  order_index: 3
};
const hidden = {
  ...row,
  id: 14,
  title: 'HIDDEN_TITLE',
  content: 'HIDDEN_BODY',
  publiclyVisible: false,
  order_index: 4
};
const scheduled = {
  ...row,
  id: 15,
  title: 'SCHEDULED_TITLE',
  content: 'SCHEDULED_BODY',
  published_at: '2027-01-01T00:00:00Z',
  order_index: 5
};

function fixture(reader = false) {
  return {
    synthetic: true,
    principal: { id: reader ? 'SYNTHETIC_READER' : 'SYNTHETIC_OWNER' },
    novel: {
      id: 1,
      user_id: 'SYNTHETIC_OWNER',
      title: 'WORK_TITLE_NOT_NEEDED',
      publiclyVisible: true
    },
    episodes: [row, second, third, hidden, scheduled].map((value) => ({
      ...value
    })),
    episodeIds: reader ? [11] : [11, 12],
    progress: { completedEpisodeIds: [11, 14, 15] },
    now: new Date('2026-11-27T00:00:00Z'),
    authorNotes: [{ body: 'PRIVATE_NOTE' }]
  };
}

function citation(source) {
  return {
    episodeId: source.id,
    offset: 0,
    quote: source.body.slice(0, 5)
  };
}

const observation = '架空データの確認候補';
const cases = [
  [
    'work-analysis',
    'work_analysis_candidates',
    ([first]) => [{ ...citation(first), kind: 'pacing', observation }]
  ],
  [
    'character-consistency',
    'character_consistency_candidates',
    ([first, second]) => [
      {
        kind: 'ability',
        first: citation(first),
        second: citation(second),
        observation
      }
    ]
  ],
  [
    'timeline-foreshadowing',
    'timeline_foreshadowing_candidates',
    ([first, second]) => [
      {
        kind: 'possible_payoff',
        first: citation(first),
        second: citation(second),
        observation
      }
    ]
  ],
  [
    'writing-assistant',
    'proposed_edits',
    ([first]) => [{ ...citation(first), replacement: '凛は鍵を' }],
    { episodeIds: [11] }
  ],
  [
    'prepublish-check',
    'prepublish_review_candidates',
    ([first]) => [{ ...citation(first), kind: 'spelling', observation }],
    { episodeIds: [11] }
  ],
  [
    'promotion-assistant',
    'promotion_drafts',
    ([first]) => [{ ...citation(first), draft: '鍵の物語' }],
    { format: 'intro50' }
  ],
  [
    'virtual-beta-reader',
    'hypothetical_ai_review',
    ([first]) =>
      ['pacing', 'character', 'clarity'].map((perspective) => ({
        ...citation(first),
        perspective,
        observation
      }))
  ],
  [
    'who-is-this-character',
    'character_source_excerpts',
    ([first]) => [citation(first)],
    { characterName: '凛' },
    true
  ],
  [
    'spoiler-safe-recap',
    'source_excerpts_only',
    ([first]) => [citation(first)],
    {},
    true
  ],
  [
    'spoiler-safe-glossary',
    'source_terms_only',
    ([first]) => [{ ...citation(first), term: '凛' }],
    {},
    true
  ]
];

// The same injected mock style as the existing Novel Bible trial; this
// helper is test-only and has no network, provider or runtime entrypoint.
async function mockTrial(feature, input, mockGenerate, current = input) {
  assert.equal(input.synthetic, true);
  assert.equal(current.synthetic, true);
  const { prompt, requestHash } = prepareOfflineEvidencePrompt(feature, input);
  const modelText = await mockGenerate(prompt);
  return reviewOfflineEvidenceResponse(feature, current, {
    requestHash,
    modelText
  });
}

for (const [feature, kind, produce, overrides, reader] of cases) {
  test('offline prompt to mock to validated output: ' + feature, async () => {
    const input = { ...fixture(reader), ...overrides };
    const before = JSON.stringify(input);
    let calls = 0;
    const result = await mockTrial(feature, input, async ({ system, user }) => {
      calls += 1;
      assert.match(system, /untrusted content/u);
      const payload = JSON.parse(user);
      const context = payload.untrusted_work_context;
      assert.equal(context.audience, reader ? 'reader' : 'author');
      assert.match(payload.task, /Return only JSON/u);
      assert.deepEqual(
        context.episodes.map((entry) => entry.id),
        input.episodeIds.map(String)
      );
      assert.doesNotMatch(
        user,
        /PRIVATE_NOTE|UNREAD_|HIDDEN_|SCHEDULED_|SYNTHETIC_|WORK_TITLE/u
      );
      for (const episode of context.episodes) {
        assert.deepEqual(Object.keys(episode), ['id', 'order', 'body']);
      }
      if (feature === 'promotion-assistant') {
        assert.equal(context.format, 'intro50');
        assert.equal(context.characterLimit, 50);
      }
      if (feature === 'who-is-this-character') {
        assert.equal(context.characterName, '凛');
      }
      return JSON.stringify({ items: produce(context.episodes) });
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, kind);
    assert.ok(result.items.length > 0);
    assert.equal(JSON.stringify(input), before);
    if (!reader) assert.equal(result.requiresAuthorReview, true);
    if (feature === 'prepublish-check') {
      assert.equal(result.blocksPublication, false);
    }
  });
}

test('invalid selections fail before the mock is called', async () => {
  const input = fixture(true);
  let calls = 0;
  const mock = async () => {
    calls += 1;
    return '{"items":[]}';
  };
  for (const episodeIds of [[13], [14], [15], [11, 11], [], [99]]) {
    await assert.rejects(
      mockTrial('spoiler-safe-recap', { ...input, episodeIds }, mock)
    );
  }
  await assert.rejects(mockTrial('work-analysis', input, mock));
  await assert.rejects(mockTrial('art-generation', input, mock));
  const foreign = fixture();
  foreign.episodes[0].novel_id = 2;
  await assert.rejects(mockTrial('work-analysis', foreign, mock));
  assert.equal(calls, 0);
});

test('source and access changes invalidate the original mock response', async () => {
  const input = fixture(true);
  const { prompt, requestHash } = prepareOfflineEvidencePrompt(
    'spoiler-safe-recap',
    input
  );
  const source = JSON.parse(prompt.user).untrusted_work_context.episodes[0];
  const response = {
    requestHash,
    modelText: JSON.stringify({ items: [citation(source)] })
  };
  const changed = fixture(true);
  changed.episodes[0].content += '改訂';
  assert.throws(() =>
    reviewOfflineEvidenceResponse('spoiler-safe-recap', changed, response)
  );
  const revoked = { ...input, progress: { completedEpisodeIds: [] } };
  assert.throws(() =>
    reviewOfflineEvidenceResponse('spoiler-safe-recap', revoked, response)
  );
  assert.throws(() =>
    reviewOfflineEvidenceResponse('spoiler-safe-glossary', input, response)
  );
});

test('the validator cannot accept unselected evidence or action fields', async () => {
  const input = fixture();
  input.episodeIds = [11];
  const forged = {
    kind: 'strength',
    episodeId: '12',
    offset: 0,
    quote: second.content,
    observation
  };
  await assert.rejects(
    mockTrial('work-analysis', input, async () =>
      JSON.stringify({ items: [forged] })
    )
  );
  await assert.rejects(
    mockTrial('work-analysis', input, async ({ user }) => {
      const source = JSON.parse(user).untrusted_work_context.episodes[0];
      const item = { ...citation(source), kind: 'strength', observation };
      return JSON.stringify({ items: [item], publish: true });
    })
  );
});
