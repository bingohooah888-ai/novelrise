// Formal-release-only composition for an existing trusted server scheduler.
// This module never registers a cron, endpoint, timer or database connection.
// Its host must independently approve formal launch and moderation provenance.
import { createFormalDurableDelivery } from './formal-earning-durable.js';
import { createFormalCanonicalSourceReader } from './formal-earning-source-reader.js';
import { reviewFormalEpisodeComment } from './formal-comment-eligibility.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINAL_STATES = new Set(['completed', 'retry', 'held']);
const MAX_PER_TICK = 25;

function boundedLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PER_TICK;
}

export function createFormalEarningRunner({
  postgresClient,
  releaseTimestampIso,
  launchConfiguration,
  trustedServerAuthorization,
  verifyModeratorReceipt
}) {
  const delivery = createFormalDurableDelivery({
    postgresClient,
    releaseTimestampIso,
    launchConfiguration,
    trustedServerAuthorization
  });
  const sourceReader = createFormalCanonicalSourceReader({ postgresClient });
  const approved = () =>
    launchConfiguration?.formalEarningsEnabled === true &&
    launchConfiguration?.productionCutoverApproved === true &&
    launchConfiguration?.formalWorkerEnabled === true &&
    trustedServerAuthorization?.serviceRoleVerified === true &&
    trustedServerAuthorization?.verifiedByTrustedServer === true;
  let draining = false;

  async function submitModeration({
    commentId,
    eligible,
    rule,
    reviewReceipt
  } = {}) {
    if (!approved()) return Object.freeze({ status: 'formal_worker_disabled' });
    if (
      typeof commentId !== 'string' ||
      !UUID.test(commentId) ||
      typeof eligible !== 'boolean' ||
      typeof rule !== 'string' ||
      rule.length < 1 ||
      rule.length > 120
    ) {
      return Object.freeze({ status: 'review_invalid' });
    }
    // No browser Boolean or unverified model verdict can authorize a review.
    // The future trusted host must validate independently stored provenance.
    if (
      typeof verifyModeratorReceipt !== 'function' ||
      !reviewReceipt ||
      typeof reviewReceipt !== 'object'
    ) {
      return Object.freeze({ status: 'review_provenance_missing' });
    }
    let verified;
    try {
      verified = await verifyModeratorReceipt({
        commentId,
        eligible,
        rule,
        reviewReceipt
      });
    } catch {
      verified = false;
    }
    if (verified !== true)
      return Object.freeze({ status: 'review_provenance_rejected' });

    let source;
    try {
      source = await sourceReader.load(
        'novel_episode_comment_reviewed',
        commentId
      );
    } catch {
      return Object.freeze({ status: 'canonical_source_unavailable' });
    }
    if (source.status !== 'canonical_source_verified')
      return Object.freeze({ status: source.status });

    const assessment = reviewFormalEpisodeComment({
      comment: source.verifiedComment,
      priorUserComments: source.verifiedPriorUserComments,
      trustedSourceVerified: true,
      reviewerDecision: eligible ? 'eligible' : 'ineligible',
      reviewerRule: rule
    });
    if (
      assessment.commentId !== commentId ||
      (assessment.mayAward !== true && assessment.mayRecordDecision !== true)
    ) {
      return Object.freeze({ status: assessment.status });
    }
    try {
      // Stores the reviewed verdict only. Point issuance remains in the
      // existing claim / canonical source / transactional ledger pipeline.
      const result = await delivery.resolveReview(commentId, eligible, rule);
      return Object.freeze({ status: result.status });
    } catch {
      return Object.freeze({ status: 'review_storage_unavailable' });
    }
  }

  async function drainDue({ limit = 10 } = {}) {
    if (!approved())
      return Object.freeze({
        status: 'formal_worker_disabled',
        processed: 0,
        pointsConfirmedByWorker: 0
      });
    if (!boundedLimit(limit))
      return Object.freeze({
        status: 'invalid_tick_limit',
        processed: 0,
        pointsConfirmedByWorker: 0
      });
    if (draining)
      return Object.freeze({
        status: 'tick_already_running',
        processed: 0,
        pointsConfirmedByWorker: 0
      });
    draining = true;
    let processed = 0;
    let completed = 0;
    let retry = 0;
    let held = 0;
    try {
      for (let i = 0; i < limit; i++) {
        let result;
        try {
          result = await delivery.processNext();
        } catch {
          return Object.freeze({
            status: 'tick_db_unavailable',
            processed,
            completed,
            retry,
            held,
            pointsConfirmedByWorker: 0
          });
        }
        if (result.status === 'no_due_event') break;
        if (!FINAL_STATES.has(result.status)) {
          return Object.freeze({
            status: 'tick_held',
            processed,
            completed,
            retry,
            held,
            pointsConfirmedByWorker: 0
          });
        }
        processed++;
        if (result.status === 'completed') completed++;
        if (result.status === 'retry') retry++;
        if (result.status === 'held') held++;
      }
      return Object.freeze({
        status: 'tick_completed',
        processed,
        completed,
        retry,
        held,
        // The ledger, not this worker, is the authority on earned balance.
        pointsConfirmedByWorker: 0
      });
    } finally {
      draining = false;
    }
  }

  function bindExistingScheduler({ registerTick, limit = 10 } = {}) {
    if (!approved()) return Object.freeze({ status: 'formal_worker_disabled' });
    if (typeof registerTick !== 'function' || !boundedLimit(limit))
      return Object.freeze({ status: 'scheduler_binding_invalid' });
    // Injected registrar belongs to an already existing trusted host.
    // Nothing here sets a timer or creates a GitHub/Vercel workflow.
    const registered = registerTick({
      taskKey: 'novelight-formal-earning-due',
      run: () => drainDue({ limit })
    });
    if (typeof registered?.unregister !== 'function')
      return Object.freeze({ status: 'scheduler_binding_incomplete' });
    return Object.freeze({
      status: 'scheduler_bound',
      unregister: registered.unregister
    });
  }

  return Object.freeze({
    submitModeration,
    drainDue,
    bindExistingScheduler
  });
}
