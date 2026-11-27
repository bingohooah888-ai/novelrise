import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  reviewCommentTopics,
  reviewCommentReply
} from '../api/_lib/ai/offline-comment-review.js';

const row = {
  id: '11',
  novel_id: 1,
  can_moderate: true,
  is_hidden: false,
  is_spoiler: false,
  body: '続きが気になります。',
  user_id: 'private-reader'
};
const input = {
  principal: { id: 'owner' },
  novel: { id: 1, user_id: 'owner' },
  comments: [
    row,
    { ...row, id: '12', is_hidden: true },
    { ...row, id: '13', is_spoiler: true }
  ]
};
const item = {
  kind: 'positive',
  commentId: '11',
  offset: 0,
  quote: '続きが気になります。'
};
const model = (items) => JSON.stringify({ items });

test('comment topic candidates retain their actual sample size', () => {
  const modelText = model([item]);
  const result = reviewCommentTopics({ ...input, modelText });
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.requiresAuthorReview, true);
  assert.ok(!JSON.stringify(result).includes('private-reader'));
  assert.throws(() =>
    reviewCommentTopics({ ...input, principal: { id: 'other' }, modelText })
  );
});

test('hidden comments and invented quotes or totals are rejected', () => {
  const invalid = [
    { ...item, commentId: '12' },
    { ...item, commentId: '13' },
    { ...item, quote: '架空' },
    { ...item, count: 100 },
    { ...item, delete: true }
  ];
  for (const candidate of invalid) {
    const modelText = model([candidate]);
    assert.throws(() => reviewCommentTopics({ ...input, modelText }));
  }
  const modelText = model([item, item]);
  assert.throws(() => reviewCommentTopics({ ...input, modelText }));
});

test('reply requires the original comment digest and manual review', () => {
  const expectedSourceHash = createHash('sha256')
    .update(JSON.stringify([row.id, row.body]))
    .digest('hex');
  const request = {
    ...input,
    commentId: row.id,
    expectedSourceHash,
    modelText: JSON.stringify({ reply: 'ありがとうございます。' })
  };
  const result = reviewCommentReply(request);
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(result.reply, 'ありがとうございます。');
  assert.throws(() =>
    reviewCommentReply({
      ...request,
      comments: [{ ...row, body: '改訂された感想' }]
    })
  );
  const modelText = JSON.stringify({ reply: '返信', send: true });
  assert.throws(() => reviewCommentReply({ ...request, modelText }));
});
