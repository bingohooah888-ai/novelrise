// Offline only. No routes, provider calls, storage, or authorization changes.
// A future server caller MUST establish work ownership, visibility, and
// completed-episode membership from trusted data before calling this module.
import { projectAiWorkContext } from './context.js';

const INVALID = 'AI_OFFLINE_EVIDENCE_INVALID';
const PERSPECTIVES = ['pacing', 'character', 'clarity'];

function invalid() {
  throw new Error(INVALID);
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Object.keys(value);
  if (keys.length !== fields.length) invalid();
  if (!fields.every((key) => Object.hasOwn(value, key))) invalid();
}

function positiveId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') invalid();
  if (typeof value === 'number' && !Number.isSafeInteger(value)) invalid();
  const id = String(value);
  if (!/^[1-9][0-9]*$/u.test(id)) invalid();
  return id;
}

function boundedText(value, max) {
  if (typeof value !== 'string' || !value.trim()) invalid();
  if (value.length > max) invalid();
  return value;
}

function projected(input, audience) {
  const novelId = positiveId(input?.novel?.id);
  const rows = input?.episodes;
  if (!Array.isArray(rows) || rows.length > 10000) invalid();
  const seen = new Set();
  for (const row of rows) {
    const id = positiveId(row?.id);
    if (seen.has(id) || positiveId(row.novel_id) !== novelId) invalid();
    if (!Number.isSafeInteger(row.order_index)) invalid();
    if (row.order_index < 0) invalid();
    if (typeof row.content !== 'string') invalid();
    seen.add(id);
  }
  const episodes =
    audience === 'reader'
      ? rows.filter((row) => row.publiclyVisible === true)
      : rows;
  return projectAiWorkContext({
    principal: input.principal,
    novel: input.novel,
    audience,
    episodes,
    progress: input.progress,
    authorNotes: [],
    now: input.now
  });
}

function parseItems(modelText, maximum) {
  if (typeof modelText !== 'string') invalid();
  if (Buffer.byteLength(modelText, 'utf8') > 12000) invalid();
  let parsed;
  try {
    parsed = JSON.parse(modelText);
  } catch {
    invalid();
  }
  exactFields(parsed, ['items']);
  if (!Array.isArray(parsed.items) || parsed.items.length > maximum) invalid();
  return parsed.items;
}

// Output is the actual source excerpt, not model-provided prose. This is
// evidence selection, not proof of a semantically correct generated summary.
function evidence(context, item) {
  const id = positiveId(item.episodeId);
  const episode = context.episodes.find((row) => row.id === id);
  if (!episode) invalid();
  const quote = boundedText(item.quote, 240);
  const offset = item.offset;
  if (!Number.isSafeInteger(offset) || offset < 0) invalid();
  const end = offset + quote.length;
  if (end > episode.body.length) invalid();
  const exactQuote = episode.body.slice(offset, end);
  if (exactQuote !== quote) invalid();
  return {
    episodeId: episode.id,
    title: episode.title,
    order: episode.order,
    offset,
    quote: exactQuote
  };
}

export function reviewRecapEvidence(input) {
  const context = projected(input, 'reader');
  const seen = new Set();
  const items = parseItems(input.modelText, 5).map((item) => {
    exactFields(item, ['episodeId', 'offset', 'quote']);
    const result = evidence(context, item);
    const key = JSON.stringify([result.episodeId, result.offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return result;
  });
  items.sort((a, b) => a.order - b.order || a.offset - b.offset);
  return { kind: 'source_excerpts_only', items };
}

export function reviewGlossaryEvidence(input) {
  const context = projected(input, 'reader');
  const seen = new Set();
  const items = parseItems(input.modelText, 10).map((item) => {
    exactFields(item, ['term', 'episodeId', 'offset', 'quote']);
    const source = evidence(context, item);
    const term = boundedText(item.term, 60);
    if (!source.quote.includes(term) || seen.has(term)) invalid();
    seen.add(term);
    return { term, ...source };
  });
  return { kind: 'source_terms_only', items };
}

// Model observations are hypotheses, never actual reader sentiment or scores.
export function reviewVirtualBetaReader(input) {
  const context = projected(input, 'author');
  const seen = new Set();
  const source = parseItems(input.modelText, PERSPECTIVES.length);
  const items = source.map((item) => {
    exactFields(item, [
      'perspective',
      'observation',
      'episodeId',
      'offset',
      'quote'
    ]);
    const perspective = item.perspective;
    if (!PERSPECTIVES.includes(perspective)) invalid();
    if (seen.has(perspective)) invalid();
    seen.add(perspective);
    const observation = boundedText(item.observation, 320);
    return { perspective, observation, ...evidence(context, item) };
  });
  if (items.length !== PERSPECTIVES.length) invalid();
  return {
    kind: 'hypothetical_ai_review',
    requiresAuthorReview: true,
    items
  };
}
