// Dormant, bounded manual batch/retry for trusted formal earning events.
// Reuses existing internal handler; no cron, queue, endpoint, storage or
// external provider is created. DB event_key remains the idempotency source.
import { reviewFormalEpisodeComment } from './formal-comment-eligibility.js';

const RETRYABLE = new Set([
  'private_rpc_failed',
  'read_time_level_unverified',
  'earlier_comment_review_pending',
  'content_review_pending_or_rejected',
  'formal_level_unavailable',
  'server_evidence_pending',
  'comment_moderation_pending'
]);
const TERMINAL = new Set([
  'recorded',
  'already_recorded',
  'already_recorded_for_episode',
  'monthly_comment_cap_reached',
  'pre_release_not_eligible',
  'self_or_missing_author',
  'reviewed_not_eligible',
  'review_conflict_requires_owner_policy'
]);
export async function deliverFormalRewardBatch({
  events,
  internalHandler,
  maxAttempts = 2
}) {
  if (
    !Array.isArray(events) ||
    events.length > 100 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    typeof internalHandler?.handleCommittedEvent !== 'function'
  ) {
    throw new TypeError('Bounded trusted event batch required');
  }
  const results = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      results.push(Object.freeze({ status: 'invalid_event', attempts: 0 }));
      continue;
    }
    let eventArgs = {
      eventType: event.eventType,
      verifiedEventId: event.verifiedEventId,
      sourceCommitted: event.sourceCommitted,
      authoritativeEvidenceVerified: event.authoritativeEvidenceVerified
    };
    if (event.eventType === 'novel_episode_comment_reviewed') {
      const decision = reviewFormalEpisodeComment({
        comment: event.verifiedComment,
        priorUserComments: event.verifiedPriorUserComments,
        trustedSourceVerified: event.trustedSourceVerified,
        reviewerDecision: event.reviewerDecision,
        reviewerRule: event.reviewerRule
      });
      if (!decision.mayAward) {
        results.push(Object.freeze({ status: decision.status, attempts: 0 }));
        continue;
      }
      // Do not accept a different event UUID from the inspected comment.
      if (event.verifiedEventId !== decision.commentId) {
        results.push(
          Object.freeze({ status: 'comment_event_mismatch', attempts: 0 })
        );
        continue;
      }
      eventArgs = {
        ...eventArgs,
        commentModerationApproved: true,
        verifiedModerationRule: decision.verifiedModerationRule
      };
    }
    let outcome;
    let attempts = 0;
    do {
      attempts++;
      try {
        outcome = await internalHandler.handleCommittedEvent(eventArgs);
      } catch {
        outcome = { status: 'private_rpc_failed', mayIssuePoints: false };
      }
      const status =
        outcome?.status === 'private_rpc_completed'
          ? outcome.databaseStatus
          : outcome?.status;
      if (TERMINAL.has(status)) {
        outcome = { ...outcome, status };
        break;
      }
      if (!RETRYABLE.has(status)) break;
    } while (attempts < maxAttempts);
    const status =
      outcome?.status === 'private_rpc_completed'
        ? outcome.databaseStatus
        : outcome?.status || 'unknown';
    results.push(
      Object.freeze({
        status,
        attempts,
        // A retryable outcome must be explicitly retained by the future
        // caller. This function itself is stateless and never queues jobs.
        needsReplay: RETRYABLE.has(status),
        mayIssuePoints: outcome?.mayIssuePoints === true
      })
    );
  }
  return Object.freeze({
    status: 'dry_run_or_authorized_internal_batch',
    results: Object.freeze(results)
  });
}
