// Phase 2 Novel Bible: deterministic, offline author-only read models.
// Data must come from trusted server queries, never request-supplied ownership.
// No provider access, AI inference, database mutation, or budget changes.
import { createHash } from 'node:crypto';

import { assertAiWorkAccess } from './context.js';

const MAX_EPISODES = 10000;
const MAX_EPISODE_BYTES = 1000000;
const MAX_FACTS = 500;
const SHA256 = /^[a-f0-9]{64}$/;
const FACT_KINDS = new Set([
  'character',
  'relationship',
  'location',
  'world',
  'timeline',
  'event',
  'foreshadowing',
  'other'
]);

function denied() {
  throw new Error('AI_NOVEL_BIBLE_INVALID_SOURCE');
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) denied();
  return id;
}

function requireAuthor(principal, novel) {
  assertAiWorkAccess({ principal, novel, audience: 'author' });
  return positiveId(novel.id);
}

function validateEpisodes(episodes, novelId) {
  if (!Array.isArray(episodes) || episodes.length > MAX_EPISODES) denied();
  const seen = new Set();
  return episodes.map((episode) => {
    if (!episode || positiveId(episode.novel_id) !== novelId) denied();
    const id = positiveId(episode.id);
    if (seen.has(id)) denied();
    seen.add(id);
    if (
      typeof episode.content !== 'string' ||
      typeof episode.title !== 'string' ||
      Buffer.byteLength(episode.content, 'utf8') > MAX_EPISODE_BYTES
    ) {
      denied();
    }
    const order = Number(episode.order_index ?? 0);
    if (!Number.isSafeInteger(order) || order < 0) denied();
    return { id, order, title: episode.title, content: episode.content };
  });
}

function episodeHash(episode) {
  return createHash('sha256')
    .update(JSON.stringify([episode.title, episode.content]))
    .digest('hex');
}

// Never return manuscript text to a scheduler or expose these IDs via an HTTP
// endpoint. Calling a paid AI provider is a separately authorized operation.
export function planNovelBibleEpisodeChanges({
  principal,
  novel,
  episodes,
  analyses,
  limit = 12
}) {
  const novelId = requireAuthor(principal, novel);
  const safeEpisodes = validateEpisodes(episodes, novelId);
  if (
    !Array.isArray(analyses) ||
    analyses.length > MAX_EPISODES ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 30
  ) {
    denied();
  }
  const known = new Set(safeEpisodes.map((episode) => episode.id));
  const previous = new Map();
  for (const analysis of analyses) {
    const id = positiveId(analysis?.episode_id);
    if (
      !known.has(id) ||
      previous.has(id) ||
      typeof analysis.source_hash !== 'string' ||
      !SHA256.test(analysis.source_hash)
    ) {
      denied();
    }
    previous.set(id, analysis.source_hash);
  }

  const changed = [];
  let unchangedCount = 0;
  for (const episode of safeEpisodes.sort(
    (a, b) => a.order - b.order || a.id - b.id
  )) {
    const sourceHash = episodeHash(episode);
    if (previous.get(episode.id) === sourceHash) {
      unchangedCount += 1;
    } else {
      changed.push({
        episodeId: episode.id,
        sourceHash,
        reason: previous.has(episode.id) ? 'changed' : 'new'
      });
    }
  }
  return {
    novelId,
    totalEpisodes: safeEpisodes.length,
    unchangedCount,
    pending: changed.slice(0, limit),
    deferredCount: Math.max(0, changed.length - limit)
  };
}

// Author-confirmed canon is never overwritten or silently reconciled with
// inferred candidates. Existing author notes/character registry stay canonical:
// this is an indexed view, not a new user-facing notebook.
export function groupNovelBibleFacts({ principal, novel, facts }) {
  const novelId = requireAuthor(principal, novel);
  if (!Array.isArray(facts) || facts.length > MAX_FACTS) denied();
  const groups = new Map();
  const seen = new Set();
  for (const row of facts) {
    if (!row || positiveId(row.novel_id) !== novelId) denied();
    const id = positiveId(row.id);
    if (seen.has(id)) denied();
    seen.add(id);
    if (
      !FACT_KINDS.has(row.fact_kind) ||
      typeof row.fact_key !== 'string' ||
      row.fact_key.length < 1 ||
      row.fact_key.length > 120 ||
      !['author_confirmed', 'ai_inferred'].includes(row.provenance) ||
      !row.fact_payload ||
      typeof row.fact_payload !== 'object' ||
      Array.isArray(row.fact_payload) ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1
    ) {
      denied();
    }
    const episodeId =
      row.source_episode_id === null || row.source_episode_id === undefined
        ? null
        : positiveId(row.source_episode_id);
    const payload = JSON.stringify(row.fact_payload);
    if (
      typeof payload !== 'string' ||
      Buffer.byteLength(payload, 'utf8') > 8192
    ) {
      denied();
    }
    const key = JSON.stringify([row.fact_kind, row.fact_key]);
    if (!groups.has(key)) {
      groups.set(key, {
        kind: row.fact_kind,
        key: row.fact_key,
        confirmed: [],
        suggestions: []
      });
    }
    const record = {
      id,
      sourceEpisodeId: episodeId,
      revision: row.revision,
      payload: JSON.parse(payload)
    };
    const group = groups.get(key);
    if (row.provenance === 'author_confirmed') {
      group.confirmed.push(record);
    } else {
      group.suggestions.push(record);
    }
  }
  return {
    novelId,
    groups: [...groups.values()]
      .sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)
      )
      .map((group) => ({
        ...group,
        confirmed: group.confirmed.sort((a, b) => a.id - b.id),
        suggestions: group.suggestions.sort((a, b) => a.id - b.id),
        needsAuthorReview:
          group.suggestions.length > 0 || group.confirmed.length > 1
      }))
  };
}
