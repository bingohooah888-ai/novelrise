import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reviewFormalEpisodeComment,
  quoteFormalPostAwardCommentReview
} from '../api/_lib/reader-reward/formal-comment-eligibility.js';
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
    reviewFormalEpisodeComment({
      ...baseline,
      priorUserComments: [other],
      reviewerDecision: undefined
    }).status,
    'repetitive_text_requires_review'
  );
  assert.equal(
    reviewFormalEpisodeComment({ ...baseline, priorUserComments: [other] })
      .status,
    'reviewed_eligible'
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
test('inconsistent successful flag on held, failed or unknown delivery is not reported as issued', async () => {
  for (const databaseStatus of [
    'read_time_level_unverified',
    'private_rpc_failed',
    'unknown'
  ]) {
    const result = await deliverFormalRewardBatch({
      events: [evt],
      maxAttempts: 1,
      internalHandler: {
        handleCommittedEvent: async () => ({
          status: 'private_rpc_completed',
          databaseStatus,
          mayIssuePoints: true
        })
      }
    });
    assert.equal(result.results[0].status, databaseStatus);
    assert.equal(result.results[0].mayIssuePoints, false);
  }
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

test('verified ineligible verdict is persisted as a review without awarding', async () => {
  const calls = [];
  const event = { ...evt, reviewerDecision: 'ineligible' };
  const r = await deliverFormalRewardBatch({
    events: [event],
    internalHandler: {
      handleCommittedEvent: async (args) => {
        calls.push(args);
        return {
          status: 'private_rpc_completed',
          databaseStatus: 'reviewed_not_eligible',
          mayIssuePoints: false
        };
      }
    }
  });
  assert.equal(r.results[0].status, 'reviewed_not_eligible');
  assert.equal(r.results[0].mayIssuePoints, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].commentContentEligible, false);
});

test('temporarily missing formal state is retryable rather than forgotten', async () => {
  let attempts = 0;
  const result = await deliverFormalRewardBatch({
    events: [{ ...evt, reviewerDecision: 'eligible' }],
    maxAttempts: 2,
    internalHandler: {
      handleCommittedEvent: async () => {
        attempts++;
        return {
          status: 'private_rpc_completed',
          databaseStatus: 'formal_state_missing',
          mayIssuePoints: false
        };
      }
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.results[0].needsReplay, true);
  assert.equal(result.results[0].mayIssuePoints, false);
});

test('post-award edits and deletion never automatically revoke confirmed Points', () => {
  const base = {
    commentId: cid,
    originalAwardLedgerId: uid,
    canonicalChangeVerified: true,
    originalAwardVerified: true,
    reversalHistoryVerified: true,
    reversalAlreadyExists: false
  };
  for (const changeKind of ['edited', 'deleted', 'hidden']) {
    const outcome = quoteFormalPostAwardCommentReview({ ...base, changeKind });
    assert.equal(outcome.status, 'manual_review_required');
    assert.equal(outcome.mayReversePoints, false);
    assert.equal(Object.hasOwn(outcome, 'originalAwardLedgerId'), false);
  }
  const verified = {
    ...base,
    changeKind: 'deleted',
    independentViolationEvidenceVerified: true,
    verifiedReviewerId: cid,
    verifiedEvidenceId: '00000000-0000-4000-8000-000000000033',
    reviewerDecision: 'reverse'
  };
  assert.equal(
    quoteFormalPostAwardCommentReview({
      ...verified,
      independentViolationEvidenceVerified: false
    }).status,
    'manual_review_required'
  );
  assert.equal(
    quoteFormalPostAwardCommentReview({
      ...verified,
      reversalHistoryVerified: false
    }).status,
    'post_award_evidence_pending'
  );
  assert.equal(
    quoteFormalPostAwardCommentReview({
      ...verified,
      reversalAlreadyExists: true
    }).status,
    'already_reversed'
  );
  const quote = quoteFormalPostAwardCommentReview(verified);
  assert.equal(quote.status, 'reversal_quote_only');
  assert.equal(quote.mayReversePoints, false);
  assert.equal(quote.originalAwardLedgerId, uid);
});
