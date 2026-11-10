// Formal reader earning rewards, inert server-adapter quotation only.
// Existing valid_read_events, novel_comments and scout_point_ledger are canonical.
// Do not use browser input as evidence or call this in the beta production path.
import {
  quoteEpisodeRewardTenths,
  quoteMonthlyCommentRewardTenths
} from './rates.js';
import { quoteScoutTenthsYenAsPoints } from './scout-point-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verifiedUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError(label + ' must be an authoritative UUID');
  }
  return value.toLowerCase();
}
function readTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) {
    throw new TypeError(label + ' requires ISO timestamp evidence');
  }
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms)) {
    throw new TypeError(label + ' must be a valid timestamp');
  }
  return ms;
}
function ledgerKeys(keys) {
  if (!Array.isArray(keys))
    throw new TypeError('Verified ledger keys required');
  const observed = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || observed.has(key)) {
      throw new TypeError(
        'Ledger key snapshot has malformed or duplicate keys'
      );
    }
    observed.add(key);
  }
  return observed;
}
function authorizeQuote({
  userId,
  formalReleaseAtMs,
  evidenceVerified,
  ledgerHistoryComplete,
  existingLedgerEventKeys
}) {
  const id = verifiedUuid(userId, 'Reader user');
  if (!Number.isSafeInteger(formalReleaseAtMs) || formalReleaseAtMs < 0) {
    throw new TypeError('Server formal release timestamp required');
  }
  if (evidenceVerified !== true || ledgerHistoryComplete !== true) {
    return { status: 'evidence_incomplete' };
  }
  return {
    status: 'verified_quote_inputs',
    id,
    releaseAtMs: formalReleaseAtMs,
    keys: ledgerKeys(existingLedgerEventKeys)
  };
}
function quoteResult({ userId, key, points, sourceEventId, kind }) {
  // Exact 10 Point = ¥1 conversion; 0.1 yen is exactly one integer Point.
  const conversion = quoteScoutTenthsYenAsPoints(points);
  return Object.freeze({
    status: 'reward_quote_only',
    userId,
    kind,
    eventKey: key,
    sourceEventId,
    pointKind: kind === 'read' ? 'formal_read_reward' : 'formal_comment_reward',
    points: conversion.points,
    // Production awards must be a separate, approved atomic ledger write.
    requiresAtomicUniqueEventKey: true,
    mayIssuePoints: false
  });
}

/**
 * For one ALREADY CONFIRMED valid_read_events row. The database has a
 * unique(reader_id, episode_id_snapshot) index for first-time qualification.
 * The actual formal level must be read by the trusted server at reward time.
 * Browser page views, sessions and arbitrary episode IDs are not evidence.
 */
export function quoteFormalReadPointReward({
  userId,
  verifiedReadEvent,
  verifiedScoutLevel,
  verifiedReadTimeLevelEvidence,
  formalReleaseAtMs,
  evidenceVerified,
  ledgerHistoryComplete,
  existingLedgerEventKeys
}) {
  const auth = authorizeQuote({
    userId,
    formalReleaseAtMs,
    evidenceVerified,
    ledgerHistoryComplete,
    existingLedgerEventKeys
  });
  if (auth.status !== 'verified_quote_inputs') {
    return Object.freeze(auth);
  }
  if (!verifiedReadEvent || typeof verifiedReadEvent !== 'object') {
    throw new TypeError('Canonical valid read event row required');
  }
  const id = verifiedUuid(verifiedReadEvent.id, 'Read event');
  if (
    verifiedUuid(verifiedReadEvent.reader_id, 'Read event reader') !== auth.id
  ) {
    return Object.freeze({ status: 'wrong_reader' });
  }
  if (
    typeof verifiedReadEvent.episode_id_snapshot !== 'string' ||
    verifiedReadEvent.episode_id_snapshot.length === 0
  ) {
    return Object.freeze({ status: 'episode_evidence_missing' });
  }
  const when = readTimestamp(
    verifiedReadEvent.qualified_at,
    'Read qualification'
  );
  if (when < auth.releaseAtMs) {
    return Object.freeze({ status: 'pre_release_not_eligible' });
  }
  const eventKey = 'formal_read_reward:' + id;
  if (auth.keys.has(eventKey)) {
    return Object.freeze({ status: 'already_awarded', eventKey });
  }
  // A LEVEL seen at claim time must not re-price a read qualified earlier.
  const snapshot = verifiedReadTimeLevelEvidence;
  if (!snapshot || snapshot.serverVerified !== true ||
      verifiedUuid(snapshot.readEventId, 'Read-time evidence event') !== id ||
      verifiedUuid(snapshot.readerId, 'Read-time evidence reader') !== auth.id ||
      snapshot.qualifiedAt !== verifiedReadEvent.qualified_at ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      snapshot.level !== verifiedScoutLevel) {
    return Object.freeze({ status: 'read_time_level_unverified' });
  }
  // The rate table itself validates the authoritative Level [1,100].
  return quoteResult({
    userId: auth.id,
    key: eventKey,
    points: quoteEpisodeRewardTenths(verifiedScoutLevel),
    sourceEventId: id,
    kind: 'read'
  });
}

/**
 * Only quote a comment AFTER its as-yet-unapproved content/evidence policy
 * has been separately validated by the server. Existing novel_comments
 * is the canonical source; community comments are not eligible by default.
 *
 * Count means CONFIRMED reward ledger claims in the OWNER-approved policy month,
 * not the number of published comments. A future authorized writer must
 * serialize this count with the unique event-key insert in one transaction.
 */
export function quoteFormalCommentPointReward({
  userId,
  verifiedComment,
  verifiedCommentReadEvent,
  verifiedNovelAuthorId,
  formalReleaseAtMs,
  evidenceVerified,
  commentPolicyApprovedAndEligible,
  verifiedPolicyMonth,
  policyMonthVerified,
  verifiedCommentInsidePolicyMonth,
  verifiedRewardedCommentsInMonth,
  ledgerHistoryComplete,
  existingLedgerEventKeys
}) {
  const auth = authorizeQuote({
    userId,
    formalReleaseAtMs,
    evidenceVerified,
    ledgerHistoryComplete,
    existingLedgerEventKeys
  });
  if (auth.status !== 'verified_quote_inputs') {
    return Object.freeze(auth);
  }
  if (commentPolicyApprovedAndEligible !== true) {
    return Object.freeze({ status: 'comment_eligibility_policy_pending' });
  }
  if (!verifiedComment || typeof verifiedComment !== 'object') {
    throw new TypeError('Canonical novel comment row required');
  }
  const id = verifiedUuid(verifiedComment.id, 'Comment');
  if (verifiedUuid(verifiedComment.user_id, 'Comment reader') !== auth.id) {
    return Object.freeze({ status: 'wrong_reader' });
  }
  if (
    (verifiedComment.deleted_at !== null &&
      verifiedComment.deleted_at !== undefined) ||
    (verifiedComment.author_hidden_at !== null &&
      verifiedComment.author_hidden_at !== undefined)
  ) {
    return Object.freeze({ status: 'comment_not_visible' });
  }
  if (readTimestamp(verifiedComment.created_at, 'Comment creation') < auth.releaseAtMs) {
    return Object.freeze({ status: 'pre_release_not_eligible' });
  }
  if (!Number.isSafeInteger(verifiedComment.episode_id) ||
      verifiedComment.episode_id <= 0) {
    return Object.freeze({ status: 'episode_required' });
  }
  if (!verifiedNovelAuthorId ||
      verifiedUuid(verifiedNovelAuthorId, 'Novel author') === auth.id) {
    return Object.freeze({ status: 'self_comment_not_eligible' });
  }
  const qualifiedRead = verifiedCommentReadEvent;
  if (!qualifiedRead || qualifiedRead.serverVerified !== true ||
      verifiedUuid(qualifiedRead.readerId, 'Comment read reader') !== auth.id ||
      qualifiedRead.episodeId !== String(verifiedComment.episode_id)) {
    return Object.freeze({ status: 'valid_read_required' });
  }
  if (readTimestamp(qualifiedRead.qualifiedAt, 'Comment read qualification') >
      readTimestamp(verifiedComment.created_at, 'Comment creation')) {
    return Object.freeze({ status: 'valid_read_required' });
  }
  const when = readTimestamp(verifiedComment.created_at, 'Comment creation');
  if (when < auth.releaseAtMs) {
    return Object.freeze({ status: 'pre_release_not_eligible' });
  }
  // The policy month/timezone boundary is not yet OWNER-approved.
  // Do not silently assume UTC, JST or client-calculated calendar months.
  if (
    policyMonthVerified !== true ||
    verifiedCommentInsidePolicyMonth !== true ||
    typeof verifiedPolicyMonth !== 'string' ||
    verifiedPolicyMonth.length === 0 ||
    verifiedPolicyMonth.length > 32
  ) {
    return Object.freeze({ status: 'month_policy_pending' });
  }
  if (
    !Number.isSafeInteger(verifiedRewardedCommentsInMonth) ||
    verifiedRewardedCommentsInMonth < 0
  ) {
    throw new RangeError(
      'Verified month ledger count must be nonnegative integer'
    );
  }
  const eventKey = 'formal_comment_reward:' + auth.id + ':' + verifiedComment.episode_id;
  if (auth.keys.has(eventKey)) {
    return Object.freeze({ status: 'already_awarded', eventKey });
  }
  if (verifiedRewardedCommentsInMonth >= 50) {
    return Object.freeze({ status: 'monthly_comment_limit_reached' });
  }
  const prior = quoteMonthlyCommentRewardTenths(
    verifiedRewardedCommentsInMonth
  );
  const after = quoteMonthlyCommentRewardTenths(
    verifiedRewardedCommentsInMonth + 1
  );
  return quoteResult({
    userId: auth.id,
    key: eventKey,
    points: after - prior,
    sourceEventId: id,
    kind: 'comment'
  });
}
