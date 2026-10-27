// Phase 02-07: validate untrusted model suggestions offline before author review.
// This module does not call AI providers, write to a database, or expose an API.
// Its caller MUST have verified owner identity, work ownership and episode data
// against authoritative server-side records before using the resulting data.
import { createHash } from 'node:crypto';

import { assertAiWorkAccess } from './context.js';

const MAX_RESULT_BYTES = 16000;
const MAX_EPISODE_BYTES = 1000000;
const MAX_SUGGESTIONS = 12;
const KINDS = new Set([
  'character',
  'relationship',
  'location',
  'world',
  'timeline',
  'event',
  'foreshadowing',
  'other'
]);
const FIELDS = new Set(['kind', 'key', 'summary', 'evidence']);
const HASH = /^[a-f0-9]{64}$/;

function invalid() {
  throw new Error('AI_BIBLE_INFERENCE_INVALID');
}

function positiveId(value) {
  const id =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(id) || id < 1) invalid();
  return id;
}

function boundedString(value, limit) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit
  ) {
    invalid();
  }
  return value.trim();
}

function exactFields(record, required) {
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).length !== required.size ||
    Object.keys(record).some((key) => !required.has(key))
  ) {
    invalid();
  }
}

// No provider-origin authority, IDs, confirmation state or write instructions
// are ever copied into the returned candidates.
export function reviewNovelBibleInference({
  principal,
  novel,
  episode,
  sourceHash,
  modelText,
  authorConfirmedFacts = []
}) {
  assertAiWorkAccess({ principal, novel, audience: 'author' });
  const novelId = positiveId(novel.id);
  const episodeId = positiveId(episode?.id);
  if (
    positiveId(episode?.novel_id) !== novelId ||
    typeof episode.title !== 'string' ||
    typeof episode.content !== 'string' ||
    Buffer.byteLength(episode.title, 'utf8') > 8192 ||
    Buffer.byteLength(episode.content, 'utf8') > MAX_EPISODE_BYTES ||
    typeof sourceHash !== 'string' ||
    !HASH.test(sourceHash) ||
    typeof modelText !== 'string' ||
    Buffer.byteLength(modelText, 'utf8') > MAX_RESULT_BYTES ||
    !Array.isArray(authorConfirmedFacts) ||
    authorConfirmedFacts.length > 500
  ) {
    invalid();
  }
  const actualHash = createHash('sha256')
    .update(JSON.stringify([episode.title, episode.content]))
    .digest('hex');
  if (actualHash !== sourceHash) invalid();

  const confirmed = new Set();
  for (const fact of authorConfirmedFacts) {
    if (!fact || !KINDS.has(fact.kind)) invalid();
    confirmed.add(JSON.stringify([fact.kind, boundedString(fact.key, 120)]));
  }

  let output;
  try {
    output = JSON.parse(modelText);
  } catch {
    invalid();
  }
  exactFields(output, new Set(['suggestions']));
  if (
    !Array.isArray(output.suggestions) ||
    output.suggestions.length > MAX_SUGGESTIONS
  ) {
    invalid();
  }

  const keys = new Set();
  const candidates = [];
  for (const suggestion of output.suggestions) {
    exactFields(suggestion, FIELDS);
    if (!KINDS.has(suggestion.kind)) invalid();
    const key = boundedString(suggestion.key, 120);
    const summary = boundedString(suggestion.summary, 320);
    const evidence = boundedString(suggestion.evidence, 160);
    // The model cannot cite another chapter, invent a quote or submit
    // an unverified episode reference as evidence for this proposal.
    if (!episode.content.includes(evidence)) invalid();
    const identity = JSON.stringify([suggestion.kind, key]);
    if (keys.has(identity)) invalid();
    keys.add(identity);
    candidates.push({
      factKind: suggestion.kind,
      factKey: key,
      factPayload: { summary, evidence },
      sourceEpisodeId: episodeId,
      sourceHash,
      provenance: 'ai_inferred',
      requiresAuthorReview: true,
      conflictsWithAuthorCanon: confirmed.has(identity)
    });
  }

  return { novelId, candidates };
}
