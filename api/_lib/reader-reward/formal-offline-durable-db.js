// Strictly synthetic PostgreSQL fixture for the EXISTING formal earning runner.
// Not a DB adapter for production, a route, a scheduler, or an authority proof.
// Tests exercise the real private-function client and queue/worker control flow.
import { createHash, randomUUID } from 'node:crypto';
import {
  quoteFormalReadPointReward,
  quoteFormalCommentPointReward
} from './formal-earning-rewards.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = Object.freeze({
  read: 'valid_read_qualified',
  comment: 'novel_episode_comment_reviewed'
});
const COMPLETED = new Set([
  'recorded',
  'already_recorded',
  'already_recorded_for_episode',
  'reviewed_not_eligible',
  'monthly_comment_cap_reached',
  'pre_release_not_eligible',
  'self_or_missing_author',
  'review_conflict_requires_owner_policy'
]);
const RETRY = new Set([
  'private_rpc_failed',
  'read_time_level_unverified',
  'earlier_comment_review_pending',
  'formal_level_unavailable',
  'formal_state_missing'
]);
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createFormalOfflineDurableDb({
  events,
  readerIds,
  operatorId,
  releaseAtMs,
  nowIso,
  repository,
  legacyEventKeys = []
} = {}) {
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    events.length > 100 ||
    !(readerIds instanceof Set) ||
    !UUID.test(operatorId || '') ||
    !Number.isSafeInteger(releaseAtMs) ||
    releaseAtMs < 0 ||
    typeof nowIso !== 'string' ||
    !Number.isFinite(Date.parse(nowIso)) ||
    typeof repository?.creditSyntheticEarning !== 'function' ||
    typeof repository?.readReader !== 'function' ||
    !Array.isArray(legacyEventKeys)
  )
    throw new TypeError('Complete OFFLINE synthetic earning fixture required');

  const byKey = new Map();
  const reads = new Map();
  const comments = new Map();
  for (const raw of events) {
    if (
      !raw ||
      !Object.hasOwn(VALID_TYPES, raw.kind) ||
      !UUID.test(raw.userId || '') ||
      !readerIds.has(raw.userId) ||
      raw.userId === operatorId
    )
      throw new TypeError('Invalid synthetic committed source');
    const source =
      raw.kind === 'read' ? raw.verifiedReadEvent : raw.verifiedComment;
    if (
      !source ||
      !UUID.test(source.id || '') ||
      (raw.kind === 'read' ? source.reader_id : source.user_id) !==
        raw.userId
    )
      throw new TypeError('Synthetic source ownership mismatch');
    const event = copy(raw);
    const key = VALID_TYPES[event.kind] + ':' + source.id;
    if (byKey.has(key))
      throw new TypeError('Duplicate synthetic canonical source identity');
    byKey.set(key, { event, source });
    if (event.sourceFixtureVerified === true) {
      if (event.kind === 'read') reads.set(source.id, source);
      else comments.set(source.id, source);
    }
  }
  const queue = new Map();
  const earned = new Map();
  const ledgerKeys = new Set(legacyEventKeys);
  let interruptOnce = false;

  const monthOf = (at) =>
    new Date(Date.parse(at) + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const lookup = (type, id) => byKey.get(type + ':' + id);
  const result = (value) => ({ rows: [{ result: value }] });

  function verifyModeratorReceipt({
    commentId,
    eligible,
    rule,
    reviewReceipt
  } = {}) {
    const matching = lookup(VALID_TYPES.comment, commentId);
    const proof = matching?.event?.moderationProof;
    if (
      !matching ||
      !comments.has(commentId) ||
      !proof ||
      !UUID.test(proof.reviewerId || '') ||
      !UUID.test(proof.reviewId || '') ||
      typeof proof.receiptKey !== 'string' ||
      !proof.receiptKey ||
      reviewReceipt?.receiptKey !== proof.receiptKey ||
      proof.eligible !== eligible ||
      proof.rule !== rule
    )
      return false;
    return {
      reviewerId: proof.reviewerId,
      reviewId: proof.reviewId,
      bodySha256: createHash('sha256')
        .update(matching.source.body, 'utf8')
        .digest('hex')
    };
  }

  async function award(type, id, values) {
    const item = lookup(type, id);
    if (!item || item.event.sourceFixtureVerified !== true)
      return { status: 'canonical_source_missing' };
    const { event, source } = item;
    let quotation;
    if (type === VALID_TYPES.read) {
      quotation = quoteFormalReadPointReward({
        userId: event.userId,
        verifiedReadEvent: source,
        verifiedScoutLevel: event.verifiedScoutLevel,
        verifiedReadTimeLevelEvidence: event.verifiedReadTimeLevelEvidence,
        formalReleaseAtMs: releaseAtMs,
        evidenceVerified: true,
        ledgerHistoryComplete: true,
        existingLedgerEventKeys: [...ledgerKeys]
      });
    } else {
      const queued = queue.get(type + ':' + id);
      if (
        !queued ||
        !queued.review ||
        queued.review.eligible !== values[2] ||
        queued.review.rule !== values[3]
      )
        return { status: 'comment_moderation_pending' };
      if (queued.review.eligible !== true)
        return { status: 'reviewed_not_eligible' };
      const claims = [...earned.values()].filter(
        (entry) =>
          entry.kind === 'comment' &&
          entry.userId === event.userId &&
          monthOf(entry.at) === monthOf(source.created_at)
      ).length;
      quotation = quoteFormalCommentPointReward({
        userId: event.userId,
        verifiedComment: source,
        verifiedCommentReadEvent: event.verifiedCommentReadEvent,
        verifiedNovelAuthorId: event.verifiedNovelAuthorId,
        formalReleaseAtMs: releaseAtMs,
        evidenceVerified: true,
        commentPolicyApprovedAndEligible: true,
        verifiedPolicyMonth: monthOf(source.created_at),
        policyMonthVerified: true,
        verifiedCommentInsidePolicyMonth: true,
        verifiedRewardedCommentsInMonth: claims,
        ledgerHistoryComplete: true,
        existingLedgerEventKeys: [...ledgerKeys]
      });
    }
    if (quotation.status === 'already_awarded')
      return { status: 'already_recorded' };
    if (quotation.status === 'monthly_comment_limit_reached')
      return { status: 'monthly_comment_cap_reached' };
    if (quotation.status !== 'reward_quote_only')
      return { status: quotation.status };
    // The real DB has an additional one-read-per-episode uniqueness guard.
    // Reproduce it here rather than allowing two UUIDs for the same chapter.
    if (
      type === VALID_TYPES.read &&
      [...earned.values()].some(
        (entry) =>
          entry.kind === 'read' &&
          entry.userId === event.userId &&
          entry.episodeId === String(source.episode_id_snapshot)
      )
    )
      return { status: 'already_recorded_for_episode' };
    const at =
      event.kind === 'read' ? source.qualified_at : source.created_at;
    const saved = await repository.creditSyntheticEarning({
      userId: event.userId,
      eventId: source.id,
      eventKey: quotation.eventKey,
      points: quotation.points,
      kind: event.kind,
      at
    });
    if (saved.status === 'recorded') {
      ledgerKeys.add(quotation.eventKey);
      earned.set(quotation.eventKey, {
        userId: event.userId,
        kind: event.kind,
        points: quotation.points,
        eventId: source.id,
        episodeId: String(
          event.kind === 'read'
            ? source.episode_id_snapshot
            : source.episode_id
        ),
        at
      });
    }
    return saved;
  }

  async function query(sql, args = []) {
    if (sql.includes('from public.valid_read_events where id='))
      return { rows: reads.has(args[0]) ? [copy(reads.get(args[0]))] : [] };
    if (sql.includes('from public.novel_comments where id='))
      return { rows: comments.has(args[0]) ? [copy(comments.get(args[0]))] : [] };
    if (sql.includes('from public.novel_comments where user_id=')) {
      const entry = [...byKey.values()].find(
        ({ event, source }) =>
          event.kind === 'comment' &&
          source.user_id === args[0] &&
          source.id === args[1]
      );
      return { rows: copy(entry?.event.verifiedPriorUserComments ?? []) };
    }
    if (sql.includes('.enqueue_earning_draft(')) {
      const [type, id] = args;
      if (!lookup(type, id)) return result({ status: 'canonical_source_missing' });
      const key = type + ':' + id;
      if (queue.has(key)) return result({ status: queue.get(key).status });
      const status =
        type === VALID_TYPES.read ? 'pending' : 'review_pending';
      queue.set(key, { type, id, status, review: null, lease: null });
      return result({ status });
    }
    if (sql.includes('.decide_earning_review_draft(')) {
      const [id, eligible, rule, reviewer, reviewId, digest, episodeId] = args;
      const item = lookup(VALID_TYPES.comment, id);
      const record = queue.get(VALID_TYPES.comment + ':' + id);
      const proof = item?.event?.moderationProof;
      if (
        !item ||
        !record ||
        !proof ||
        proof.reviewerId !== reviewer ||
        proof.reviewId !== reviewId ||
        proof.eligible !== eligible ||
        proof.rule !== rule ||
        item.source.episode_id !== episodeId ||
        createHash('sha256').update(item.source.body, 'utf8').digest('hex') !==
          digest
      )
        return result({ status: 'review_provenance_rejected' });
      if (record.review) {
        return result({
          status:
            record.review.eligible === eligible && record.review.rule === rule
              ? 'review_recorded'
              : 'review_conflict_requires_owner_policy'
        });
      }
      record.review = { eligible, rule };
      record.status = 'pending';
      return result({ status: 'review_recorded' });
    }
    if (sql.includes('.claim_earning_draft(')) {
      const entry = [...queue.values()].find(
        (candidate) => ['pending', 'retry'].includes(candidate.status)
      );
      if (!entry) return result({ status: 'no_due_event' });
      entry.status = 'leased';
      entry.lease = randomUUID();
      return result({
        status: 'leased',
        event_type: entry.type,
        event_id: entry.id,
        lease_token: entry.lease,
        ...(entry.review
          ? {
              moderation_decision: entry.review.eligible,
              moderation_rule: entry.review.rule
            }
          : {})
      });
    }
    if (sql.includes('.award_read_points_draft(')) {
      if (interruptOnce) {
        interruptOnce = false;
        throw new Error('OFFLINE_AWARD_OUTAGE');
      }
      if (Date.parse(args[1]) !== releaseAtMs)
        return result({ status: 'formal_release_mismatch' });
      return result(await award(VALID_TYPES.read, args[0], args));
    }
    if (sql.includes('.review_comment_and_award_draft(')) {
      if (interruptOnce) {
        interruptOnce = false;
        throw new Error('OFFLINE_AWARD_OUTAGE');
      }
      if (Date.parse(args[1]) !== releaseAtMs)
        return result({ status: 'formal_release_mismatch' });
      return result(await award(VALID_TYPES.comment, args[0], args));
    }
    if (sql.includes('.finish_earning_draft(')) {
      const [type, id, lease, outcome] = args;
      const record = queue.get(type + ':' + id);
      if (!record || record.status !== 'leased' || record.lease !== lease)
        return result({ status: 'held' });
      record.lease = null;
      record.status = COMPLETED.has(outcome)
        ? 'completed'
        : RETRY.has(outcome)
          ? 'retry'
          : 'held';
      return result({ status: record.status });
    }
    throw new Error('UNEXPECTED_OFFLINE_SQL');
  }

  async function getAdminRewardOverview() {
    const all = [...earned.values()];
    const month = monthOf(nowIso);
    const inMonth = all.filter((entry) => monthOf(entry.at) === month);
    const sum = (rows) =>
      rows.reduce((total, entry) => total + entry.points, 0);
    const eligibleAvailable = (
      await Promise.all(
        [...readerIds].map((id) => repository.readReader(id))
      )
    ).reduce((total, row) => total + row.wallet.exchangeEligiblePoints, 0);
    const pending = await repository.listPendingExchanges();
    const settled = repository.getSyntheticUsageTotals();
    return {
      status: 'reward_overview_ready',
      period: 'current_jst_calendar_month',
      pointsPerYen: 10,
      issuedMonth: sum(inMonth),
      issuedTotal: sum(all),
      readMonth: sum(inMonth.filter((entry) => entry.kind === 'read')),
      commentMonth: sum(inMonth.filter((entry) => entry.kind === 'comment')),
      giftSpentNet: settled.giftSpentNet,
      aiSpentNet: settled.aiSpentNet,
      eligibleAvailable,
      eligibleReserved: pending.reduce(
        (total, item) => total + item.eligibleReservedPoints,
        0
      ),
      pendingExchangePoints: pending.reduce(
        (total, item) => total + item.amountPoints,
        0
      ),
      pendingExchangeCount: pending.length,
      recent: all.slice(-30).reverse().map((entry) => ({
        eventId: entry.eventId,
        userId: entry.userId,
        kind:
          entry.kind === 'read'
            ? 'formal_read_reward'
            : 'formal_comment_reward',
        points: entry.points,
        status: 'confirmed',
        occurredAt: entry.at
      }))
    };
  }

  return Object.freeze({
    query,
    verifyModeratorReceipt,
    getAdminRewardOverview,
    // Explicitly test-only: introduce a single transient error, then replay.
    interruptNextSyntheticAward: () => {
      interruptOnce = true;
    },
    inspectQueue: () =>
      Object.freeze(
        [...queue.values()].map(({ type, id, status }) => ({
          type,
          id,
          status
        }))
      )
  });
}
