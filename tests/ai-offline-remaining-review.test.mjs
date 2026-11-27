import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  reviewNaturalSearch,
  reviewClassificationCandidate,
  reviewInquirySupport
} from '../api/_lib/ai/offline-selection-review.js';
import {
  reviewCommentModeration,
  reviewSimilarityEvidence
} from '../api/_lib/ai/offline-policy-review.js';
import { reviewSpoilerCommentCandidates } from '../api/_lib/ai/offline-comment-review.js';
import {
  reviewReportTriage,
  reviewAbuseSignals,
  reviewKpiChanges
} from '../api/_lib/ai/offline-aggregate-review.js';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const request = (snapshot, output) => ({
  snapshot,
  expectedHash: digest(snapshot),
  modelText: JSON.stringify(output)
});
const items = (item) => ({ items: [item] });

test('natural search preserves explicit filters and original order', () => {
  const row = {
    novelId: '1',
    title: '旅',
    description: '王都の門',
    genre: '幻想',
    tags: ['冒険']
  };
  const snapshot = {
    query: '王都',
    genre: '幻想',
    tags: ['冒険'],
    rows: [row, { ...row, novelId: '2' }]
  };
  const item = { novelId: '1', field: 'description', quote: '王都' };
  const result = reviewNaturalSearch(
    request(snapshot, { items: [{ ...item, novelId: '2' }, item] })
  );
  assert.deepEqual(
    result.items.map((entry) => entry.novelId),
    ['1', '2']
  );
  assert.equal(result.rankingChanged, false);
  assert.throws(() =>
    reviewNaturalSearch(request({ ...snapshot, genre: '恋愛' }, items(item)))
  );
  assert.throws(() =>
    reviewNaturalSearch(request(snapshot, items({ ...item, score: 100 })))
  );
});

test('classification candidates cite metadata and allowed genres only', () => {
  const snapshot = {
    novelId: '1',
    title: '旅',
    description: '王都の門',
    genre: '幻想',
    genres: ['幻想', '冒険']
  };
  const item = { genre: '冒険', field: 'description', quote: '王都' };
  const result = reviewClassificationCandidate(request(snapshot, items(item)));
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.currentGenre, '幻想');
  assert.throws(() =>
    reviewClassificationCandidate(
      request(snapshot, items({ ...item, genre: 'unknown' }))
    )
  );
  assert.throws(() =>
    reviewClassificationCandidate(
      request(snapshot, items({ ...item, quote: '捏造' }))
    )
  );
});

test('inquiry output selects official excerpts, not generated promises', () => {
  const snapshot = {
    id: 'case-1',
    redactedBody: '投稿方法について',
    categories: ['publishing', 'other']
  };
  const topics = [
    {
      key: 'publishing',
      title: '投稿',
      summary: '公開操作の説明',
      points: ['手順']
    }
  ];
  const output = {
    category: 'publishing',
    items: [{ key: 'publishing', part: 'point', index: 0 }]
  };
  const input = {
    ...request(snapshot, output),
    topics,
    expectedTopicsHash: digest(topics)
  };
  const result = reviewInquirySupport(input);
  assert.equal(result.excerpts[0].quote, '手順');
  assert.equal(result.requiresHumanReview, true);
  assert.ok(!JSON.stringify(result).includes(snapshot.redactedBody));
  assert.throws(() =>
    reviewInquirySupport({
      ...input,
      modelText: JSON.stringify({ ...output, send: true })
    })
  );
});

test('comment moderation binds visible comment and official policy', () => {
  const comment = { id: '1', body: '確認対象', visible: true };
  const policy = [{ section: '5', body: '正式規約' }];
  const item = {
    section: '5',
    policyQuote: '正式規約',
    offset: 0,
    quote: '確認対象'
  };
  const input = {
    comment,
    expectedCommentHash: digest(comment),
    policy,
    expectedPolicyHash: digest(policy),
    modelText: JSON.stringify(items(item))
  };
  const result = reviewCommentModeration(input);
  assert.equal(result.automaticAction, false);
  assert.equal(result.violationVerified, false);
  assert.throws(() =>
    reviewCommentModeration({
      ...input,
      comment: { ...comment, visible: false }
    })
  );
  assert.throws(() =>
    reviewCommentModeration({
      ...input,
      modelText: JSON.stringify(items({ ...item, ban: true }))
    })
  );
});

test('similarity evidence verifies both passages and returns offsets', () => {
  const quote = 'abcdefghijklmnopqrst';
  const snapshot = {
    first: { id: '1', body: quote },
    second: { id: '2', body: 'x' + quote }
  };
  const item = { firstOffset: 0, secondOffset: 1, quote };
  const result = reviewSimilarityEvidence(request(snapshot, items(item)));
  assert.equal(result.plagiarismVerified, false);
  assert.equal(result.items[0].length, 20);
  assert.ok(!JSON.stringify(result).includes(quote));
  assert.throws(() =>
    reviewSimilarityEvidence(
      request(snapshot, items({ ...item, secondOffset: 0 }))
    )
  );
  const short = items({ ...item, quote: 'abc' });
  assert.throws(() => reviewSimilarityEvidence(request(snapshot, short)));
});

test('spoiler review returns comment IDs without future story text', () => {
  const row = {
    id: 1,
    novel_id: 1,
    status: 'published',
    publiclyVisible: true,
    order_index: 1,
    title: '門',
    content: '王都'
  };
  const later = { ...row, id: 2, order_index: 2, content: '秘密の鍵' };
  const episodes = [row, later];
  const comment = { id: '11', novelId: 1, visible: true, body: '秘密の鍵' };
  const comments = [comment];
  const references = [{ id: '1', episodeId: '2', term: '秘密の鍵' }];
  const input = {
    principal: { id: 'reader' },
    novel: { id: 1, publiclyVisible: true },
    episodes,
    progress: { completedEpisodeIds: [1] },
    now: new Date('2026-11-27T00:00:00Z'),
    comments,
    references,
    expectedHash: digest({ comments, references }),
    modelText: JSON.stringify(items({ commentId: '11', referenceId: '1' }))
  };
  const result = reviewSpoilerCommentCandidates(input);
  assert.deepEqual(result.items, [{ commentId: '11' }]);
  assert.ok(!JSON.stringify(result).includes('秘密'));
  assert.throws(() =>
    reviewSpoilerCommentCandidates({
      ...input,
      progress: { completedEpisodeIds: [1, 2] }
    })
  );
  assert.throws(() =>
    reviewSpoilerCommentCandidates({
      ...input,
      episodes: [row, { ...episodes[1], novel_id: 2 }]
    })
  );
  assert.throws(() =>
    reviewSpoilerCommentCandidates({
      ...input,
      comments: [{ ...comments[0], visible: false }]
    })
  );
});

test('report triage cannot select resolved or unknown reports', () => {
  const row = { id: '11', category: 'other', status: 'new' };
  const result = reviewReportTriage(request([row], { ids: ['11'] }));
  assert.equal(result.receivedCount, 1);
  assert.equal(result.violationVerified, false);
  assert.throws(() => reviewReportTriage(request([row], { ids: ['99'] })));
  assert.throws(() =>
    reviewReportTriage(
      request([{ ...row, status: 'resolved' }], { ids: ['11'] })
    )
  );
});

test('abuse review cannot confirm or invent a signal', () => {
  const row = {
    id: 'signal-1',
    status: 'active',
    signalType: 'robotic_valid_read_burst'
  };
  const result = reviewAbuseSignals(request([row], { ids: [row.id] }));
  assert.equal(result.abuseVerified, false);
  assert.equal(result.items[0].status, 'active');
  assert.throws(() =>
    reviewAbuseSignals(
      request([{ ...row, status: 'dismissed' }], { ids: [row.id] })
    )
  );
  assert.throws(() =>
    reviewAbuseSignals(request([row], { ids: [row.id], ban: true }))
  );
});

test('KPI review distinguishes changes from verified anomalies', () => {
  const row = { metric: 'newUsers', current: 100, previous: 80 };
  const snapshot = { days: 7, rows: [row] };
  const output = { metrics: ['newUsers'] };
  const result = reviewKpiChanges(request(snapshot, output));
  assert.equal(result.items[0].difference, 20);
  assert.equal(result.statisticalAnomalyVerified, false);
  for (const previous of [null, 1, -1]) {
    assert.throws(() =>
      reviewKpiChanges(
        request({ ...snapshot, rows: [{ ...row, previous }] }, output)
      )
    );
  }
  assert.throws(() =>
    reviewKpiChanges(request(snapshot, { ...output, cause: 'guessed' }))
  );
});
