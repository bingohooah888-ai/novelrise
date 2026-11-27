// Offline only. No routes, provider calls, storage, or authorization changes.
// A future server caller MUST establish work ownership, visibility, and
// completed-episode membership from trusted data before calling this module.
import { createHash } from 'node:crypto';
import { assertAiWorkAccess, projectAiWorkContext } from './context.js';

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

// Bound suggestions to the full original episode revision, not just to
// matching words that may reappear after an edit. The expected revisions
// must have been captured at request creation by the trusted caller.
function revision(input, source) {
  const row = input.episodes.find(
    (episode) => String(episode.id) === source.episodeId
  );
  const expected = input.expectedRevisions;
  if (!expected || typeof expected !== 'object') invalid();
  if (!Object.hasOwn(expected, source.episodeId)) invalid();
  if (typeof row.title !== 'string') invalid();
  if (Buffer.byteLength(row.content, 'utf8') > 1000000) invalid();
  const actual = createHash('sha256')
    .update(JSON.stringify([row.title, row.content]))
    .digest('hex');
  if (expected[source.episodeId] !== actual) invalid();
  return actual;
}

export function reviewWritingEdits(input) {
  const context = projected(input, 'author');
  const items = parseItems(input.modelText, 8).map((item) => {
    exactFields(item, ['episodeId', 'offset', 'quote', 'replacement']);
    const source = evidence(context, item);
    const replacement = boundedText(item.replacement, 600);
    if (replacement === source.quote) invalid();
    return { ...source, sourceHash: revision(input, source), replacement };
  });
  // Reject ambiguous or overlapping suggestions, instead of making edits.
  for (let i = 0; i < items.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.episodeId !== b.episodeId) continue;
      if (
        a.offset < b.offset + b.quote.length &&
        b.offset < a.offset + a.quote.length
      )
        invalid();
    }
  }
  return { kind: 'proposed_edits', requiresAuthorReview: true, items };
}

const CHECK_KINDS = [
  'spelling',
  'format',
  'repetition',
  'point_of_view',
  'continuity'
];

export function reviewPrepublishIssues(input) {
  const context = projected(input, 'author');
  const seen = new Set();
  const items = parseItems(input.modelText, 12).map((item) => {
    exactFields(item, ['kind', 'episodeId', 'offset', 'quote', 'observation']);
    if (!CHECK_KINDS.includes(item.kind)) invalid();
    const source = evidence(context, item);
    const key = JSON.stringify([item.kind, source.episodeId, source.offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      ...source,
      sourceHash: revision(input, source),
      kind: item.kind,
      observation: boundedText(item.observation, 320)
    };
  });
  return {
    kind: 'prepublish_review_candidates',
    requiresAuthorReview: true,
    blocksPublication: false,
    items
  };
}

// Analysis candidates are tied to the original manuscript, not to a score.
// No generated assertion is considered a confirmed literary fact.
export function reviewWorkAnalysis(input) {
  const context = projected(input, 'author');
  const kinds = ['strength', 'pacing', 'structure', 'readability', 'viewpoint'];
  const seen = new Set();
  const items = parseItems(input.modelText, 8).map((item) => {
    exactFields(item, ['kind', 'episodeId', 'offset', 'quote', 'observation']);
    if (!kinds.includes(item.kind)) invalid();
    const source = evidence(context, item);
    const key = JSON.stringify([item.kind, source.episodeId, source.offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      kind: item.kind,
      observation: boundedText(item.observation, 320),
      ...source,
      sourceHash: revision(input, source)
    };
  });
  return {
    kind: 'work_analysis_candidates',
    requiresAuthorReview: true,
    items
  };
}

// Both passages must be present in the same authorized work and revision.
// The relationship is a hypothesis; chronology in the text is not story time.
function compareEvidence(input, kinds, resultKind) {
  const context = projected(input, 'author');
  const seen = new Set();
  const items = parseItems(input.modelText, 6).map((item) => {
    exactFields(item, ['kind', 'first', 'second', 'observation']);
    if (!kinds.includes(item.kind)) invalid();
    const pair = [item.first, item.second].map((entry) => {
      exactFields(entry, ['episodeId', 'offset', 'quote']);
      const source = evidence(context, entry);
      return { ...source, sourceHash: revision(input, source) };
    });
    const keys = pair.map((entry) =>
      JSON.stringify([entry.episodeId, entry.offset])
    );
    if (keys[0] === keys[1]) invalid();
    const [a, b] = pair;
    if (a.episodeId === b.episodeId) {
      const overlap =
        a.offset < b.offset + b.quote.length &&
        b.offset < a.offset + a.quote.length;
      if (overlap) invalid();
    }
    const identity = JSON.stringify([item.kind, ...keys.sort()]);
    if (seen.has(identity)) invalid();
    seen.add(identity);
    return {
      kind: item.kind,
      observation: boundedText(item.observation, 320),
      passages: pair
    };
  });
  return { kind: resultKind, requiresAuthorReview: true, items };
}

export function reviewCharacterConsistency(input) {
  return compareEvidence(
    input,
    ['name', 'voice', 'ability', 'age', 'relationship'],
    'character_consistency_candidates'
  );
}

export function reviewTimelineForeshadowing(input) {
  return compareEvidence(
    input,
    ['chronology', 'location', 'time_span', 'possible_payoff'],
    'timeline_foreshadowing_candidates'
  );
}

// Only exact, already-read passages containing the explicitly requested name.
// Never copy a model's invented role, relationship or character biography.
export function reviewCharacterRecall(input) {
  const context = projected(input, 'reader');
  const name = boundedText(input.characterName, 80);
  const seen = new Set();
  const items = parseItems(input.modelText, 5).map((item) => {
    exactFields(item, ['episodeId', 'offset', 'quote']);
    const source = evidence(context, item);
    if (!source.quote.includes(name)) invalid();
    const key = JSON.stringify([source.episodeId, source.offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return source;
  });
  items.sort((a, b) => a.order - b.order || a.offset - b.offset);
  return { kind: 'character_source_excerpts', name, items };
}

// A publisher-facing outline uses selected source excerpts only. No invented
// credentials, audience statistics, rights or claims about publication.
export function reviewPublishingOutline(input) {
  const context = projected(input, 'author');
  const kinds = ['plot', 'character', 'setting', 'theme'];
  const seen = new Set();
  const items = parseItems(input.modelText, 12).map((item) => {
    exactFields(item, ['kind', 'episodeId', 'offset', 'quote']);
    if (!kinds.includes(item.kind)) invalid();
    const source = evidence(context, item);
    const key = JSON.stringify([item.kind, source.episodeId, source.offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      kind: item.kind,
      ...source,
      sourceHash: revision(input, source)
    };
  });
  return {
    kind: 'publishing_source_outline',
    requiresAuthorReview: true,
    items
  };
}

const PROMOTION_LIMITS = Object.freeze({
  intro50: 50,
  intro150: 150,
  synopsis: 2000,
  social: 140
});

// Draft only. Character limits are local Unicode code-point limits, not a
// promise that a social platform will accept the text.
export function reviewPromotionDraft(input) {
  const context = projected(input, 'author');
  if (!Object.hasOwn(PROMOTION_LIMITS, input.format)) invalid();
  const items = parseItems(input.modelText, 3).map((item) => {
    exactFields(item, ['draft', 'episodeId', 'offset', 'quote']);
    const source = evidence(context, item);
    const draft = boundedText(item.draft, 4000);
    if (Array.from(draft).length > PROMOTION_LIMITS[input.format]) {
      invalid();
    }
    return { draft, ...source, sourceHash: revision(input, source) };
  });
  const unique = new Set(items.map((item) => item.draft));
  if (unique.size !== items.length) invalid();
  return {
    kind: 'promotion_drafts',
    format: input.format,
    requiresAuthorReview: true,
    items
  };
}

// Candidate B is bound to the original work metadata, never an active
// experiment, publication operation or measured conversion claim.
export function reviewMetadataVariants(input) {
  const { principal, novel } = input;
  assertAiWorkAccess({ principal, novel, audience: 'author' });
  const metadata = input.metadata;
  exactFields(metadata, ['novelId', 'title', 'description']);
  if (positiveId(metadata.novelId) !== positiveId(novel.id)) invalid();
  boundedText(metadata.title, 100);
  if (typeof metadata.description !== 'string') invalid();
  if (metadata.description.length > 2000) invalid();
  const sourceHash = createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');
  if (input.expectedMetadataHash !== sourceHash) invalid();
  const seen = new Set([
    JSON.stringify([metadata.title.trim(), metadata.description.trim()])
  ]);
  const items = parseItems(input.modelText, 3).map((item) => {
    exactFields(item, ['title', 'description']);
    const title = boundedText(item.title, 100).trim();
    const description = boundedText(item.description, 2000).trim();
    const key = JSON.stringify([title, description]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return { title, description };
  });
  return {
    kind: 'metadata_drafts',
    sourceHash,
    requiresAuthorReview: true,
    experimentStarted: false,
    items
  };
}
