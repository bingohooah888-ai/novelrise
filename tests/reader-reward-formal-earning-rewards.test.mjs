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
  id: readId, reader_id: userId, episode_id_snapshot: '456',
  qualified_at: '2027-02-01T01:00:00Z'
};
const comment = {
  id: commentId, user_id: userId, created_at: '2027-02-01T01:00:00Z',
  deleted_at: null, author_hidden_at: null
};
function quoteRead(overrides = {}) {
  return quoteFormalReadPointReward({
    userId, verifiedReadEvent: read, verifiedScoutLevel: 1,
    formalReleaseAtMs, evidenceVerified: true, ledgerHistoryComplete: true,
    existingLedgerEventKeys: [], ...overrides
  });
}
function quoteComment(overrides = {}) {
  return quoteFormalCommentPointReward({
    userId, verifiedComment: comment, formalReleaseAtMs,
    evidenceVerified: true, commentPolicyApprovedAndEligible: true,
    verifiedPolicyMonth: 'example-policy-2027-02', policyMonthVerified: true, verifiedCommentInsidePolicyMonth: true, verifiedRewardedCommentsInMonth: 0,
    ledgerHistoryComplete: true, existingLedgerEventKeys: [], ...overrides
  });
}
test('read tier quotes are exactly 1..11 integer Scout Points, no rounding or mint', () => {
  for (const [level, points] of [
    [1,1],[19,1],[20,2],[39,2],[40,3],[60,4],
    [70,5],[75,6],[80,7],[85,8],[90,9],[95,10],[99,10],[100,11]
  ]) {
    const q=quoteRead({ verifiedScoutLevel: level });
    assert.equal(q.status,'reward_quote_only');
    assert.equal(q.points,points);
    assert.equal(q.mayIssuePoints,false);
    assert.equal(q.pointKind,'formal_read_reward');
    assert.equal(q.sourceEventId,readId);
    assert.equal(q.eventKey,'formal_read_reward:'+readId);
  }
});
test('read duplicate, wrong reader and pre-release are not quoted', () => {
  assert.equal(quoteRead({ existingLedgerEventKeys:['formal_read_reward:'+readId] }).status,'already_awarded');
  assert.equal(quoteRead({ verifiedReadEvent:{...read,reader_id:otherId} }).status,'wrong_reader');
  assert.equal(quoteRead({ verifiedReadEvent:{...read,qualified_at:'2026-12-31T23:59:00Z'} }).status,'pre_release_not_eligible');
  assert.equal(quoteRead({ verifiedReadEvent:{...read,episode_id_snapshot:''} }).status,'episode_evidence_missing');
});
test('unverified read evidence cannot be rewarded', () => {
  assert.equal(quoteRead({ evidenceVerified:false }).status,'evidence_incomplete');
  assert.equal(quoteRead({ ledgerHistoryComplete:false }).status,'evidence_incomplete');
  assert.throws(()=>quoteRead({ verifiedScoutLevel:101 }),RangeError);
});
test('comment awards exactly 20 Point through the 50th verified claim', () => {
  for (const n of [0,1,48,49]) {
    const q=quoteComment({verifiedRewardedCommentsInMonth:n});
    assert.equal(q.status,'reward_quote_only');
    assert.equal(q.points,20);
    assert.equal(q.mayIssuePoints,false);
    assert.equal(q.pointKind,'formal_comment_reward');
  }
  assert.equal(quoteComment({verifiedRewardedCommentsInMonth:50}).status,'monthly_comment_limit_reached');
  assert.equal(quoteComment({verifiedRewardedCommentsInMonth:100}).status,'monthly_comment_limit_reached');
});
test('comment without approved eligibility stays blocked', () => {
  assert.equal(quoteComment({ commentPolicyApprovedAndEligible:false }).status,'comment_eligibility_policy_pending');
  assert.equal(quoteComment({ commentPolicyApprovedAndEligible:undefined }).status,'comment_eligibility_policy_pending');
});
test('comment duplicate, wrong reader, hidden and deleted cannot earn', () => {
  assert.equal(quoteComment({existingLedgerEventKeys:['formal_comment_reward:'+commentId]}).status,'already_awarded');
  assert.equal(quoteComment({verifiedComment:{...comment,user_id:otherId}}).status,'wrong_reader');
  assert.equal(quoteComment({verifiedComment:{...comment,deleted_at:'2027-02-03T00:00:00Z'}}).status,'comment_not_visible');
  assert.equal(quoteComment({verifiedComment:{...comment,author_hidden_at:'2027-02-03T00:00:00Z'}}).status,'comment_not_visible');
});
test('comment requires server approved period membership after release', () => {
  assert.equal(quoteComment({policyMonthVerified:false}).status,'month_policy_pending');
  assert.equal(quoteComment({verifiedCommentInsidePolicyMonth:false}).status,'month_policy_pending');
  assert.equal(quoteComment({verifiedComment:{...comment,created_at:'2026-12-31T23:59:00Z'}}).status,'pre_release_not_eligible');
  assert.throws(()=>quoteComment({verifiedRewardedCommentsInMonth:-1}),RangeError);
});
test('the shared ledger history must be complete and unique', () => {
  assert.equal(quoteComment({ledgerHistoryComplete:false}).status,'evidence_incomplete');
  assert.throws(()=>quoteRead({existingLedgerEventKeys:['foo','foo']}),TypeError);
});
