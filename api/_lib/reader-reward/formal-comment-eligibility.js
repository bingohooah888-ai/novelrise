// Dormant, formal-release-only content eligibility classifier.
// The authoritative novel_comments row and same-user comment history must
// be retrieved by a trusted service. This code does not issue Points.
// Semantic relevance is a moderation decision, not a keyword guess.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HISTORY = 200;
function normalise(value) {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('ja-JP');
}
export function reviewFormalEpisodeComment({
  comment,
  priorUserComments,
  trustedSourceVerified,
  reviewerDecision,
  reviewerRule
}) {
  const blocked = Object.freeze({
    status: 'eligibility_evidence_pending',
    mayAward: false
  });
  if (
    trustedSourceVerified !== true ||
    !comment ||
    !UUID.test(comment.id) ||
    !UUID.test(comment.user_id) ||
    !Number.isSafeInteger(comment.episode_id) ||
    comment.episode_id <= 0 ||
    !Array.isArray(priorUserComments) ||
    priorUserComments.length > MAX_HISTORY
  ) {
    return blocked;
  }
  if (
    (comment.deleted_at !== null && comment.deleted_at !== undefined) ||
    (comment.author_hidden_at !== null &&
      comment.author_hidden_at !== undefined) ||
    typeof comment.body !== 'string'
  ) {
    return Object.freeze({
      status: 'ineligible_hidden_or_missing',
      mayAward: false
    });
  }
  const text = normalise(comment.body);
  if (!text) {
    return Object.freeze({ status: 'ineligible_blank', mayAward: false });
  }
  for (const previous of priorUserComments) {
    if (
      !previous ||
      previous.user_id !== comment.user_id ||
      typeof previous.body !== 'string' ||
      !Number.isSafeInteger(previous.episode_id)
    ) {
      return blocked;
    }
  }
  // Identical cross-episode repetition is suspicious, but "template spam"
  // thresholds aren't OWNER-defined. Hold for review; do not guess rejection.
  const exactCrossEpisode = priorUserComments.some(
    (previous) =>
      previous.id !== comment.id &&
      previous.episode_id !== comment.episode_id &&
      normalise(previous.body) === text
  );
  if (exactCrossEpisode && reviewerDecision !== 'ineligible') {
    return Object.freeze({
      status: 'repetitive_text_requires_review',
      mayAward: false
    });
  }
  // Irrelevant content cannot be detected from untrusted client text alone.
  if (reviewerDecision !== 'eligible' && reviewerDecision !== 'ineligible') {
    return Object.freeze({
      status: 'semantic_review_required',
      mayAward: false
    });
  }
  if (
    typeof reviewerRule !== 'string' ||
    reviewerRule.length < 1 ||
    reviewerRule.length > 120
  ) {
    return blocked;
  }
  if (reviewerDecision === 'ineligible') {
    return Object.freeze({
      status: 'reviewed_ineligible',
      mayAward: false,
      mayRecordDecision: true,
      commentId: comment.id,
      verifiedModerationRule: reviewerRule
    });
  }
  return Object.freeze({
    status: 'reviewed_eligible',
    mayAward: true,
    commentId: comment.id,
    verifiedModerationRule: reviewerRule
  });
}
