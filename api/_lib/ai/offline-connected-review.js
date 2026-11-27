// Internal offline handoff only. Not a public route. No provider or router,
// persistence, credentials, HTTP requests, or automatic action is introduced.
// prepare is server-only; never send its prompt to the browser. The response
// argument to review MUST be the server's candidate, not a browser request.
import { requireAiFeature } from './registry.js';

const FEATURES = Object.freeze({
  'work-analysis': ['owner', 'work_analysis_candidates'],
  'character-consistency': ['owner', 'character_consistency_candidates'],
  'timeline-foreshadowing': ['owner', 'timeline_foreshadowing_candidates'],
  'writing-assistant': ['owner', 'proposed_edits'],
  'prepublish-check': ['owner', 'prepublish_review_candidates'],
  'promotion-assistant': ['owner', 'promotion_drafts'],
  'analytics-copilot': ['owner', 'analytics_review'],
  'reader-dropoff-analysis': ['owner', 'continuation_review_candidates'],
  'virtual-beta-reader': ['owner', 'hypothetical_ai_review'],
  'thumbnail-coordinator': ['owner', 'official_material_candidates'],
  'title-synopsis-ab': ['owner', 'metadata_drafts'],
  'comment-summary': ['owner', 'comment_review_candidates'],
  'comment-reply-assistant': ['owner', 'reply_draft'],
  'author-growth-report': ['owner', 'author_period_observations'],
  'publishing-preparation': ['owner', 'publishing_source_outline'],
  'natural-search-ai': ['reader', 'natural_search_evidence'],
  'discovery-assistant': ['reader', 'public_metadata_matches'],
  'report-triage': ['report', 'report_review_selection'],
  'abuse-analysis': ['abuse', 'abuse_signal_review'],
  'classification-anomaly': ['selection', 'classification_review_candidates'],
  'official-faq-assistant': ['selection', 'official_help_excerpts'],
  'comment-moderation': ['policy', 'comment_moderation_candidates'],
  'policy-risk-review': ['policy', 'policy_review_candidates'],
  'inquiry-assistant': ['selection', 'inquiry_review_draft'],
  'error-log-summary': ['incident', 'observed_incident_counts'],
  'kpi-anomaly': ['kpi', 'kpi_change_review']
});

function invalid() {
  throw new Error('AI_OFFLINE_HANDOFF_UNAVAILABLE');
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).length !== keys.length) invalid();
  if (!keys.every((key) => Object.hasOwn(value, key))) invalid();
}

// Adapters must be trusted existing authorization-bound readers, instantiated
// by an approved host. No dependency is synthesized or granted here.
export function createOfflineConnectedReview(readers = {}) {
  function resolve(request, auth) {
    exact(request, ['featureKey', 'selection']);
    const { featureKey, selection } = request;
    if (typeof featureKey !== 'string') invalid();
    if (!Object.hasOwn(FEATURES, featureKey)) invalid();
    const feature = requireAiFeature(featureKey);
    const [name, kind] = FEATURES[featureKey];
    if (!Object.hasOwn(readers, name)) invalid();
    const reader = readers[name];
    if (
      typeof reader?.prepare !== 'function' ||
      typeof reader?.review !== 'function'
    ) {
      invalid();
    }
    let args;
    if (feature.audience === 'author' || feature.audience === 'reader') {
      exact(auth, ['token']);
      if (typeof auth.token !== 'string') invalid();
      args = [featureKey, selection, auth.token];
    } else {
      exact(auth, ['req', 'res']);
      if (!auth.req || !auth.res) invalid();
      if (name === 'report' || name === 'abuse') {
        exact(selection, []);
        args = [auth.req, auth.res];
      } else if (name === 'incident' || name === 'kpi') {
        args = [selection, auth.req, auth.res];
      } else {
        args = [featureKey, selection, auth.req, auth.res];
      }
    }
    return { reader, args, kind, featureKey };
  }

  return Object.freeze({
    async prepare(request, auth) {
      try {
        const { reader, args } = resolve(request, auth);
        const prepared = await reader.prepare(...args);
        if (!/^[a-f0-9]{64}$/u.test(prepared?.requestHash)) invalid();
        if (typeof prepared?.prompt?.system !== 'string') invalid();
        if (typeof prepared?.prompt?.user !== 'string') invalid();
        return {
          requestHash: prepared.requestHash,
          prompt: {
            system: prepared.prompt.system,
            user: prepared.prompt.user
          }
        };
      } catch {
        invalid();
      }
    },
    async review(request, auth, candidate) {
      try {
        exact(candidate, ['requestHash', 'modelText']);
        if (!/^[a-f0-9]{64}$/u.test(candidate.requestHash)) invalid();
        if (typeof candidate.modelText !== 'string') invalid();
        if (candidate.modelText.length > 35000) invalid();
        const { reader, args, kind, featureKey } = resolve(request, auth);
        const result = await reader.review(...args, candidate);
        if (result?.kind !== kind) invalid();
        // Only the validated candidate result, never raw model text or prompt.
        // The host remains responsible for delivery to the same actor.
        return { featureKey, result };
      } catch {
        invalid();
      }
    }
  });
}
