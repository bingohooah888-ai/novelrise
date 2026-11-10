import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewFormalEpisodeComment } from '../api/_lib/reader-reward/formal-comment-eligibility.js';
import { deliverFormalRewardBatch } from '../api/_lib/reader-reward/formal-earning-delivery.js';

const uid = '00000000-0000-4000-8000-000000000031';
const cid = '00000000-0000-4000-8000-000000000032';
const c = {
  id: cid,
  user_id: uid,
  episode_id: 55,
  body: 'この伏線の回収が意外で面白かったです',
  deleted_at: null,
  author_hidden_at: null
};
const baseline = {
  comment: c,
  priorUserComments: [],
  trustedSourceVerified: true,
  reviewerDecision: 'eligible',
  reviewerRule: 'reviewed-server-v1'
};
const evt = {
  eventType: 'novel_episode_comment_reviewed',
  verifiedEventId: cid,
  sourceCommitted: true,
  authoritativeEvidenceVerified: true,
  trustedSourceVerified: true,
  verifiedComment: c,
  verifiedPriorUserComments: [],
  reviewerDecision: 'eligible',
  reviewerRule: 'reviewed-server-v1'
};
test('no client semantic guess: reviewer evidence required, ambiguous comments held', () => {
  assert.equal(
    reviewFormalEpisodeComment({ ...baseline, reviewerDecision: undefined })
      .status,
    'semantic_review_required'
  );
  assert.equal(
    reviewFormalEpisodeComment({ ...baseline, trustedSourceVerified: false })
      .status,
    'eligibility_evidence_pending'
  );
  assert.equal(
    reviewFormalEpisodeComment(baseline).status,
    'reviewed_eligible'
  );
});
test('blank and hidden comments excluded; cross-episode identical comments held', () => {
  assert.equal(
    reviewFormalEpisodeComment({ ...baseline, comment: { ...c, body: ' 　' } })
      .status,
    'ineligible_blank'
  );
  assert.equal(
    reviewFormalEpisodeComment({
      ...baseline,
      comment: { ...c, deleted_at: '2027-01-01' }
    }).status,
    'ineligible_hidden_or_missing'
  );
  const other = {
    ...c,
    id: '00000000-0000-4000-8000-000000000033',
    episode_id: 99
  };
  assert.equal(
    reviewFormalEpisodeComment({ ...baseline, priorUserComments: [other] })
      .status,
    'repetitive_text_requires_review'
  );
  assert.equal(
    reviewFormalEpisodeComment({
      ...baseline,
      priorUserComments: [other],
      reviewerDecision: 'ineligible'
    }).status,
    'reviewed_ineligible'
  );
});
test('delivery is explicitly internal; comment moderation hold cannot call DB handler', async () => {
  let calls = 0;
  const result = await deliverFormalRewardBatch({
    events: [{ ...evt, reviewerDecision: null }],
    internalHandler: {
      handleCommittedEvent: async () => {
        calls++;
        return {
          status: 'private_rpc_completed',
          databaseStatus: 'recorded',
          mayIssuePoints: true
        };
      }
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.results[0].status, 'semantic_review_required');
});
test('bounded retry reuses identical idempotent event and handles success', async () => {
  let calls = 0,
    keys = [];
  const r = await deliverFormalRewardBatch({
    events: [evt],
    maxAttempts: 3,
    internalHandler: {
      handleCommittedEvent: async (input) => {
        calls++;
        keys.push(input.verifiedEventId);
        if (calls === 1)
          return { status: 'private_rpc_failed', mayIssuePoints: false };
        return {
          status: 'private_rpc_completed',
          databaseStatus: 'recorded',
          mayIssuePoints: true
        };
      }
    }
  });
  assert.equal(r.results[0].status, 'recorded');
  assert.equal(r.results[0].attempts, 2);
  assert.deepEqual(keys, [cid, cid]);
});
test('server database already-recorded status is terminal and never retried', async () => {
  let calls = 0;
  const r = await deliverFormalRewardBatch({
    events: [evt],
    maxAttempts: 3,
    internalHandler: {
      handleCommittedEvent: async () => {
        calls++;
        return {
          status: 'private_rpc_completed',
          databaseStatus: 'already_recorded_for_episode',
          mayIssuePoints: false
        };
      }
    }
  });
  assert.equal(calls, 1);
  assert.equal(r.results[0].status, 'already_recorded_for_episode');
});
test('pending outcome and disabled execution do not claim Point issuance', async () => {
  const retry = await deliverFormalRewardBatch({
    events: [evt],
    maxAttempts: 1,
    internalHandler: {
      handleCommittedEvent: async () => ({
        status: 'private_rpc_completed',
        databaseStatus: 'earlier_comment_review_pending',
        mayIssuePoints: false
      })
    }
  });
  assert.equal(retry.results[0].needsReplay, true);
  const stop = await deliverFormalRewardBatch({
    events: [evt],
    maxAttempts: 3,
    internalHandler: {
      handleCommittedEvent: async () => ({
        status: 'formal_connection_disabled',
        mayIssuePoints: false
      })
    }
  });
  assert.equal(stop.results[0].attempts, 1);
  assert.equal(stop.results[0].mayIssuePoints, false);
});
test('only bounded batches and matching reviewed event IDs are processed', async () => {
  let calls = 0;
  const r = await deliverFormalRewardBatch({
    events: [{ ...evt, verifiedEventId: uid }],
    internalHandler: {
      handleCommittedEvent: async () => {
        calls++;
      }
    }
  });
  assert.equal(calls, 0);
  assert.equal(r.results[0].status, 'comment_event_mismatch');
  await assert.rejects(
    deliverFormalRewardBatch({
      events: Array(101).fill(evt),
      internalHandler: { handleCommittedEvent: async () => {} }
    }),
    TypeError
  );
});

test('verified ineligible verdict is persisted as a review without awarding',async()=>{
  const calls=[];
  const event={...evt,reviewerDecision:'ineligible'};
  const r=await deliverFormalRewardBatch({events:[event],internalHandler:{
    handleCommittedEvent:async args=>{
      calls.push(args);
      return {status:'private_rpc_completed',databaseStatus:'reviewed_not_eligible',mayIssuePoints:false};
    }
  }});
  assert.equal(r.results[0].status,'reviewed_not_eligible');
  assert.equal(r.results[0].mayIssuePoints,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].commentContentEligible,false);
});
