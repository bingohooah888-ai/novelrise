import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  reviewRecapEvidence,
  reviewGlossaryEvidence,
  reviewVirtualBetaReader,
  reviewWritingEdits,
  reviewPrepublishIssues,
  reviewWorkAnalysis,
  reviewCharacterConsistency,
  reviewTimelineForeshadowing,
  reviewCharacterRecall,
  reviewPublishingOutline,
  reviewPromotionDraft,
  reviewMetadataVariants
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

const authorInput = {
  ...input,
  principal: { id: 'author' },
  expectedRevisions: {
    11: createHash('sha256')
      .update(JSON.stringify([row.title, row.content]))
      .digest('hex')
  }
};

test('writing edits are bound to the exact revision and never applied', () => {
  const item = { ...quote, replacement: '王城の門' };
  const modelText = model([item]);
  const before = JSON.stringify(authorInput);
  const result = reviewWritingEdits({ ...authorInput, modelText });
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(result.items[0].replacement, item.replacement);
  assert.equal(result.items[0].sourceHash, authorInput.expectedRevisions[11]);
  assert.equal(JSON.stringify(authorInput), before);
  assert.throws(() => reviewWritingEdits({ ...input, modelText }));
  assert.throws(() =>
    reviewWritingEdits({
      ...authorInput,
      episodes: [{ ...row, content: body + '改訂' }],
      modelText
    })
  );
  assert.throws(() =>
    reviewWritingEdits({ ...authorInput, modelText: model([item, item]) })
  );
});

test('prepublish observations are candidates and cannot block publication', () => {
  const item = {
    ...quote,
    kind: 'continuity',
    observation: '確認候補'
  };
  const modelText = model([item]);
  const result = reviewPrepublishIssues({ ...authorInput, modelText });
  assert.equal(result.blocksPublication, false);
  assert.equal(result.items[0].kind, 'continuity');
  const forged = model([{ ...item, block: true }]);
  assert.throws(() =>
    reviewPrepublishIssues({ ...authorInput, modelText: forged })
  );
  assert.throws(() =>
    reviewPrepublishIssues({
      ...authorInput,
      expectedRevisions: {},
      modelText
    })
  );
});

test('work analysis is evidence-bound and cannot submit a score', () => {
  const item = { ...quote, kind: 'strength', observation: '確認候補' };
  const modelText = model([item]);
  const result = reviewWorkAnalysis({ ...authorInput, modelText });
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(result.items[0].sourceHash, authorInput.expectedRevisions[11]);
  const forged = model([{ ...item, score: 100 }]);
  assert.throws(() =>
    reviewWorkAnalysis({ ...authorInput, modelText: forged })
  );
});

test('character and timeline reviews require two real distinct passages', () => {
  const pair = {
    first: quote,
    second: { ...quote, offset: 4, quote: 'で鍵' },
    observation: '確認候補'
  };
  for (const [review, kind] of [
    [reviewCharacterConsistency, 'name'],
    [reviewTimelineForeshadowing, 'possible_payoff']
  ]) {
    const item = { ...pair, kind };
    const result = review({ ...authorInput, modelText: model([item]) });
    assert.equal(result.items[0].passages.length, 2);
    assert.equal(result.requiresAuthorReview, true);
    const duplicate = { ...item, second: quote };
    assert.throws(() =>
      review({ ...authorInput, modelText: model([duplicate]) })
    );
    const falseQuote = { ...item, second: { ...quote, quote: '未来' } };
    assert.throws(() =>
      review({ ...authorInput, modelText: model([falseQuote]) })
    );
    assert.throws(() => review({ ...input, modelText: model([item]) }));
  }
});

test('character recall returns read source text only', () => {
  const request = { ...input, characterName: '王都' };
  const result = reviewCharacterRecall({
    ...request,
    modelText: model([quote])
  });
  assert.equal(result.items[0].quote, quote.quote);
  assert.throws(() =>
    reviewCharacterRecall({
      ...request,
      characterName: '未登場',
      modelText: model([quote])
    })
  );
  const futureQuote = { episodeId: '12', offset: 0, quote: '秘密' };
  assert.throws(() =>
    reviewCharacterRecall({
      ...request,
      characterName: '秘密',
      modelText: model([futureQuote])
    })
  );
});

test('publication outline cannot invent evidence or statistics', () => {
  const item = { ...quote, kind: 'setting' };
  const result = reviewPublishingOutline({
    ...authorInput,
    modelText: model([item])
  });
  assert.equal(result.items[0].kind, 'setting');
  const forged = model([{ ...item, sales: 1000 }]);
  assert.throws(() =>
    reviewPublishingOutline({ ...authorInput, modelText: forged })
  );
});

test('promotion drafts obey selected length and never auto-publish', () => {
  const item = { ...quote, draft: '王都の物語' };
  const request = { ...authorInput, format: 'intro50' };
  const result = reviewPromotionDraft({
    ...request,
    modelText: model([item])
  });
  assert.equal(result.requiresAuthorReview, true);
  const long = model([{ ...item, draft: 'あ'.repeat(51) }]);
  assert.throws(() => reviewPromotionDraft({ ...request, modelText: long }));
  const forged = model([{ ...item, publish: true }]);
  assert.throws(() => reviewPromotionDraft({ ...request, modelText: forged }));
});

test('metadata drafts reject stale metadata and duplicate variants', () => {
  const metadata = { novelId: 1, title: '門', description: '旅' };
  const expectedMetadataHash = createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');
  const item = { title: '王都', description: '新しい旅' };
  const request = {
    principal: authorInput.principal,
    novel,
    metadata,
    expectedMetadataHash
  };
  const modelText = model([item]);
  const result = reviewMetadataVariants({ ...request, modelText });
  assert.equal(result.experimentStarted, false);
  assert.deepEqual(result.items, [item]);
  assert.throws(() =>
    reviewMetadataVariants({
      ...request,
      metadata: { ...metadata, title: '改訂' },
      modelText
    })
  );
  assert.throws(() =>
    reviewMetadataVariants({ ...request, modelText: model([item, item]) })
  );
});
