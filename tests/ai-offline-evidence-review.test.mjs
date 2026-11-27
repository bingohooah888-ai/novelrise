import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reviewRecapEvidence,
  reviewGlossaryEvidence,
  reviewVirtualBetaReader
} from '../api/_lib/ai/offline-evidence-review.js';

const novel = { id: 1, user_id: 'author', publiclyVisible: true };
const principal = { id: 'reader' };
const body = '王都の門で鍵を見つけた。';
const row = {
  id: 11,
  novel_id: 1,
  status: 'published',
  publiclyVisible: true,
  order_index: 1,
  title: '門',
  content: body
};
const future = {
  ...row,
  id: 12,
  order_index: 2,
  title: '未来',
  content: '秘密の正体'
};
const input = {
  novel,
  principal,
  episodes: [row, future],
  progress: { completedEpisodeIds: [11] },
  now: new Date('2026-11-27T00:00:00Z')
};
const quote = { episodeId: '11', offset: 0, quote: '王都の門' };
const model = (items) => JSON.stringify({ items });

test('recap only returns verified excerpts from read episodes', () => {
  const modelText = model([quote]);
  const result = reviewRecapEvidence({ ...input, modelText });
  assert.equal(result.kind, 'source_excerpts_only');
  assert.equal(result.items[0].quote, quote.quote);
  assert.equal(result.items[0].title, row.title);
  assert.equal(result.items.length, 1);
  const invalid = [
    { ...quote, episodeId: '12', quote: '秘密' },
    { ...quote, quote: '捏造' },
    { ...quote, offset: 1 },
    { ...quote, summary: 'future' }
  ];
  for (const item of invalid) {
    assert.throws(
      () => reviewRecapEvidence({ ...input, modelText: model([item]) }),
      /AI_OFFLINE_EVIDENCE_INVALID/u
    );
  }
});

test('reader projection rejects missing progress and foreign work', () => {
  const modelText = model([quote]);
  assert.throws(() =>
    reviewRecapEvidence({ ...input, progress: null, modelText })
  );
  const foreign = { ...row, novel_id: 2 };
  assert.throws(() =>
    reviewRecapEvidence({ ...input, episodes: [foreign], modelText })
  );
  const hidden = { ...row, publiclyVisible: false };
  assert.throws(() =>
    reviewRecapEvidence({ ...input, episodes: [hidden], modelText })
  );
  const scheduled = { ...row, published_at: '2027-01-01T00:00:00Z' };
  assert.throws(() =>
    reviewRecapEvidence({ ...input, episodes: [scheduled], modelText })
  );
});

test('glossary never returns a term missing from verified evidence', () => {
  const item = { ...quote, term: '王都' };
  const result = reviewGlossaryEvidence({
    ...input,
    modelText: model([item])
  });
  assert.equal(result.kind, 'source_terms_only');
  assert.equal(result.items[0].term, '王都');
  assert.throws(() =>
    reviewGlossaryEvidence({
      ...input,
      modelText: model([{ ...item, term: '秘密' }])
    })
  );
});

test('beta review is owner only and explicitly hypothetical', () => {
  const items = ['pacing', 'character', 'clarity'].map((perspective) => ({
    perspective,
    observation: '確認候補',
    ...quote
  }));
  const modelText = model(items);
  const owner = { ...input, principal: { id: 'author' }, modelText };
  const result = reviewVirtualBetaReader(owner);
  assert.equal(result.kind, 'hypothetical_ai_review');
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(result.items.length, 3);
  assert.throws(() => reviewVirtualBetaReader({ ...input, modelText }));
  assert.throws(() =>
    reviewVirtualBetaReader({ ...owner, modelText: model(items.slice(0, 2)) })
  );
  const forged = items.map((item) => ({ ...item, score: 90 }));
  assert.throws(() =>
    reviewVirtualBetaReader({ ...owner, modelText: model(forged) })
  );
});

test('bounded evidence rejects duplicate and oversized model results', () => {
  const modelText = model([quote, quote]);
  assert.throws(() => reviewRecapEvidence({ ...input, modelText }));
  assert.throws(() =>
    reviewRecapEvidence({ ...input, modelText: ' '.repeat(12001) })
  );
  assert.deepEqual(
    reviewRecapEvidence({ ...input, progress: null, modelText: model([]) }),
    { kind: 'source_excerpts_only', items: [] }
  );
});
