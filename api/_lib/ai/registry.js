// NOVELIGHT AI: approved development scope (2026-10-27).
// This registry does not enable any feature or authorize provider spending.
const definitions = [
  [1, 'work-analysis', 'author', 'high', 'medium'],
  [2, 'novel-bible', 'author', 'high', 'medium'],
  [3, 'character-consistency', 'author', 'high', 'medium'],
  [4, 'timeline-foreshadowing', 'author', 'high', 'medium'],
  [5, 'writing-assistant', 'author', 'high', 'medium'],
  [6, 'prepublish-check', 'author', 'high', 'light'],
  [7, 'promotion-assistant', 'author', 'high', 'light'],
  [8, 'analytics-copilot', 'author', 'high', 'medium'],
  [9, 'reader-dropoff-analysis', 'author', 'medium-high', 'medium'],
  [10, 'target-reader-analysis', 'author', 'medium', 'medium'],
  [11, 'virtual-beta-reader', 'author', 'medium-high', 'heavy'],
  [12, 'natural-search-ai', 'reader', 'high', 'light'],
  [13, 'discovery-assistant', 'reader', 'medium-high', 'light'],
  [14, 'who-is-this-character', 'reader', 'high', 'light'],
  [15, 'spoiler-safe-recap', 'reader', 'high', 'medium'],
  [16, 'spoiler-safe-glossary', 'reader', 'high', 'light'],
  [17, 'thumbnail-coordinator', 'author', 'medium-high', 'light'],
  [18, 'title-synopsis-ab', 'author', 'medium', 'light'],
  [19, 'comment-summary', 'author', 'medium-high', 'light'],
  [20, 'comment-reply-assistant', 'author', 'medium-high', 'light'],
  [21, 'spoiler-comment-detection', 'reader', 'medium-high', 'medium'],
  [22, 'author-growth-report', 'author', 'medium-high', 'medium'],
  [23, 'publishing-preparation', 'author', 'medium', 'medium'],
  [26, 'comment-moderation', 'admin', 'high', 'light'],
  [27, 'report-triage', 'admin', 'high', 'light'],
  [28, 'abuse-analysis', 'admin', 'high', 'medium'],
  [29, 'classification-anomaly', 'admin', 'medium', 'light'],
  [31, 'policy-risk-review', 'admin', 'high', 'medium'],
  [32, 'inquiry-assistant', 'admin', 'high', 'light'],
  [33, 'official-faq-assistant', 'admin', 'high', 'light'],
  [34, 'error-log-summary', 'admin', 'high', 'light'],
  [35, 'kpi-anomaly', 'admin', 'medium-high', 'light'],
  [36, 'art-generation', 'author', 'medium', 'heavy']
];

export const AI_FEATURES = Object.freeze(
  Object.fromEntries(
    definitions.map(([id, key, audience, priority, costTier]) => [
      key,
      Object.freeze({ id, key, audience, priority, costTier })
    ])
  )
);

export const APPROVED_AI_FEATURE_COUNT = definitions.length;

export function requireAiFeature(key) {
  if (typeof key !== 'string' || !Object.hasOwn(AI_FEATURES, key)) {
    throw new Error('AI_FEATURE_NOT_APPROVED');
  }
  return AI_FEATURES[key];
}
