import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteFormalReadPointReward,
  quoteFormalCommentPointReward
} from '../api/_lib/reader-reward/formal-earning-rewards.js';

const userId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const readId = '00000000-0000-4000-8000-000000000003';
const commentId = '00000000-0000-4000-8000-000000000004';
const formalReleaseAtMs = Date.parse('2027-01-01T00:00:00Z');
const read = {
  id: readId,
  reader_id: userId,
  episode_id_snapshot: '456',
  qualified_at: '2027-02-01T01:00:00Z'
};
const comment = {
  id: commentId,
  user_id: userId,
  episode_id: 456,
  created_at: '2027-02-01T01:00:00Z',
  deleted_at: null,
  author_hidden_at: null
};
function quoteRead(overrides = {}) {
  const verifiedScoutLevel = overrides.verifiedScoutLevel ?? 1;
  return quoteFormalReadPointReward({
    userId,
    verifiedReadEvent: read,
    verifiedScoutLevel,
    verifiedReadTimeLevelEvidence: {
      readEventId: readId,
      readerId: userId,
      qualifiedAt: read.qualified_at,
      level: verifiedScoutLevel,
      revision: 10,
      serverVerified: true
    },
    formalReleaseAtMs,
    evidenceVerified: true,
    ledgerHistoryComplete: true,
    existingLedgerEventKeys: [],
    ...overrides
  });
}
function quoteComment(overrides = {}) {
  return quoteFormalCommentPointReward({
    userId,
    verifiedComment: comment,
    verifiedNovelAuthorId: otherId,
    verifiedCommentReadEvent: { serverVerified: true, readerId: userId, episodeId: '456', qualifiedAt: '2027-02-01T00:55:00Z' },
    formalReleaseAtMs,
    evidenceVerified: true,
    commentPolicyApprovedAndEligible: true,
    verifiedPolicyMonth: '2027-02',
    policyMonthVerified: true,
    verifiedCommentInsidePolicyMonth: true,
    verifiedRewardedCommentsInMonth: 0,
    ledgerHistoryComplete: true,
    existingLedgerEventKeys: [],
    ...overrides
  });
}
test('read tier quotes are exactly 1..11 integer Scout Points, no rounding or mint', () => {
  for (const [level, points] of [
    [1, 1],
    [19, 1],
    [20, 2],
    [39, 2],
    [40, 3],
    [60, 4],
    [70, 5],
    [75, 6],
    [80, 7],
    [85, 8],
    [90, 9],
    [95, 10],
    [99, 10],
    [100, 11]
  ]) {
    const q = quoteRead({ verifiedScoutLevel: level });
    assert.equal(q.status, 'reward_quote_only');
    assert.equal(q.points, points);
    assert.equal(q.mayIssuePoints, false);
    assert.equal(q.pointKind, 'formal_read_reward');
    assert.equal(q.sourceEventId, readId);
    assert.equal(q.eventKey, 'formal_read_reward:' + readId);
  }
});
test('read duplicate, wrong reader and pre-release are not quoted', () => {
  assert.equal(
    quoteRead({ existingLedgerEventKeys: ['formal_read_reward:' + readId] })
      .status,
    'already_awarded'
  );
  assert.equal(
    quoteRead({ verifiedReadEvent: { ...read, reader_id: otherId } }).status,
    'wrong_reader'
  );
  assert.equal(
    quoteRead({
      verifiedReadEvent: { ...read, qualified_at: '2026-12-31T23:59:00Z' }
    }).status,
    'pre_release_not_eligible'
  );
  assert.equal(
    quoteRead({ verifiedReadEvent: { ...read, episode_id_snapshot: '' } })
      .status,
    'episode_evidence_missing'
  );
});
test('unverified read evidence cannot be rewarded', () => {
  assert.equal(
    quoteRead({ evidenceVerified: false }).status,
    'evidence_incomplete'
  );
  assert.equal(
    quoteRead({ ledgerHistoryComplete: false }).status,
    'evidence_incomplete'
  );
  assert.throws(() => quoteRead({ verifiedScoutLevel: 101 }), RangeError);
  assert.equal(quoteRead({ verifiedReadTimeLevelEvidence: null }).status, 'read_time_level_unverified');
  assert.equal(quoteRead({ verifiedReadTimeLevelEvidence: {readEventId:readId,readerId:userId,qualifiedAt:read.qualified_at,level:1,revision:10,serverVerified:false} }).status, 'read_time_level_unverified');
});
test('comment awards exactly 20 Point through the 50th verified claim', () => {
  for (const n of [0, 1, 48, 49]) {
    const q = quoteComment({ verifiedRewardedCommentsInMonth: n });
    assert.equal(q.status, 'reward_quote_only');
    assert.equal(q.points, 20);
    assert.equal(q.mayIssuePoints, false);
    assert.equal(q.pointKind, 'formal_comment_reward');
  }
  assert.equal(
    quoteComment({ verifiedRewardedCommentsInMonth: 50 }).status,
    'monthly_comment_limit_reached'
  );
  assert.equal(
    quoteComment({ verifiedRewardedCommentsInMonth: 100 }).status,
    'monthly_comment_limit_reached'
  );
});
test('comment without approved eligibility stays blocked', () => {
  assert.equal(
    quoteComment({ commentPolicyApprovedAndEligible: false }).status,
    'comment_eligibility_policy_pending'
  );
  assert.equal(
    quoteComment({ commentPolicyApprovedAndEligible: undefined }).status,
    'comment_eligibility_policy_pending'
  );
});
test('comment duplicate, wrong reader, hidden and deleted cannot earn', () => {
  assert.equal(
    quoteComment({
      existingLedgerEventKeys: ['formal_comment_reward:' + userId + ':456']
    }).status,
    'already_awarded'
  );
  assert.equal(
    quoteComment({ verifiedComment: { ...comment, user_id: otherId } }).status,
    'wrong_reader'
  );
  assert.equal(
    quoteComment({
      verifiedComment: { ...comment, deleted_at: '2027-02-03T00:00:00Z' }
    }).status,
    'comment_not_visible'
  );
  assert.equal(
    quoteComment({
      verifiedComment: { ...comment, author_hidden_at: '2027-02-03T00:00:00Z' }
    }).status,
    'comment_not_visible'
  );
});
test('comment requires server approved period membership after release', () => {
  assert.equal(
    quoteComment({ policyMonthVerified: false }).status,
    'month_policy_mismatch'
  );
  assert.equal(
    quoteComment({ verifiedCommentInsidePolicyMonth: false }).status,
    'month_policy_pending'
  );
  assert.equal(
    quoteComment({
      verifiedComment: { ...comment, created_at: '2026-12-31T23:59:00Z' }
    }).status,
    'pre_release_not_eligible'
  );
  assert.throws(
    () => quoteComment({ verifiedRewardedCommentsInMonth: -1 }),
    RangeError
  );
});
test('the shared ledger history must be complete and unique', () => {
  assert.equal(
    quoteComment({ ledgerHistoryComplete: false }).status,
    'evidence_incomplete'
  );
  assert.throws(
    () => quoteRead({ existingLedgerEventKeys: ['foo', 'foo'] }),
    TypeError
  );
});

test('comment needs qualifying chapter-read and excludes self-comment', () => {
  assert.equal(quoteComment({verifiedComment:{...comment,episode_id:null}}).status,'episode_required');
  assert.equal(quoteComment({verifiedNovelAuthorId:userId}).status,'self_comment_not_eligible');
  assert.equal(quoteComment({verifiedCommentReadEvent:null}).status,'valid_read_required');
  assert.equal(quoteComment({verifiedCommentReadEvent:{serverVerified:true,readerId:userId,episodeId:'456',qualifiedAt:'2027-02-01T01:10:00Z'}}).status,'valid_read_required');
  assert.equal(quoteComment({verifiedCommentReadEvent:{serverVerified:true,readerId:userId,episodeId:'555',qualifiedAt:'2027-02-01T00:00:00Z'}}).status,'valid_read_required');
});
test('per-episode one-time comment key is shared across comment IDs', () => {
  const first=quoteComment();
  const later=quoteComment({verifiedComment:{...comment,id:'00000000-0000-4000-8000-000000000099'}});
  assert.equal(first.eventKey,'formal_comment_reward:'+userId+':456');
  assert.equal(later.eventKey,first.eventKey);
  assert.equal(quoteComment({existingLedgerEventKeys:[first.eventKey]}).status,'already_awarded');
});

test('JST month boundary cannot be faked by a UTC calendar assumption', () => {
  const justAfterMidnightJst={...comment,created_at:'2027-01-31T15:00:01Z'};
  const earlierRead={serverVerified:true,readerId:userId,episodeId:'456',qualifiedAt:'2027-01-31T14:00:00Z'};
  const q=quoteComment({verifiedComment:justAfterMidnightJst,verifiedCommentReadEvent:earlierRead,verifiedPolicyMonth:'2027-02'});
  assert.equal(q.status,'reward_quote_only');
  assert.equal(quoteComment({verifiedComment:justAfterMidnightJst,verifiedCommentReadEvent:earlierRead,verifiedPolicyMonth:'2027-01'}).status,'month_policy_mismatch');
});
