// Phase 02-07-02: offline, server-only changed-chapter segment planning.
// Caller MUST use authoritative owner/novel/episode/analysis queries.
// Neither function invokes a provider, accesses the network or writes data.
import { createHash } from 'node:crypto';

import { planNovelBibleEpisodeChanges } from './novel-bible.js';

const MAX_CHUNK_BYTES = 4096;
const HASH = /^[a-f0-9]{64}$/;

function invalid() {
  throw new Error('AI_BIBLE_CHUNK_INVALID');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function ensureUnicodeScalar(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid();
    }
  }
}

// UTF-16 offsets are only used for server-side String.slice(), not sent to
// models. Iterate by Unicode codepoint to avoid splitting surrogate pairs.
function segments(content, episodeId, sourceHash, reason, offset = 0) {
  ensureUnicodeScalar(content);
  const items = [];
  let start = 0;
  let bytes = 0;
  for (let pos = 0; pos < content.length;) {
    const symbol = String.fromCodePoint(content.codePointAt(pos));
    const symbolBytes = Buffer.byteLength(symbol, 'utf8');
    if (bytes + symbolBytes > MAX_CHUNK_BYTES) {
      const text = content.slice(start, pos);
      items.push({
        episodeId,
        sourceHash,
        reason,
        start: start + offset,
        end: pos + offset,
        byteLength: bytes,
        chunkHash: sha256(text)
      });
      start = pos;
      bytes = 0;
    }
    bytes += symbolBytes;
    pos += symbol.length;
  }
  if (start < content.length) {
    items.push({
      episodeId,
      sourceHash,
      reason,
      start: start + offset,
      end: content.length + offset,
      byteLength: bytes,
      chunkHash: sha256(content.slice(start))
    });
  }
  return items;
}

// Find the smallest changed window in the CURRENT manuscript. Old text never
// leaves the trusted server and is never placed in queue metadata. Codepoint
// boundaries prevent clipping Japanese emoji or supplementary characters.
// A removal-only revision has no new excerpt to send to a model.
function changedWindow(previous, current) {
  ensureUnicodeScalar(previous);
  ensureUnicodeScalar(current);
  let start = 0;
  while (start < previous.length && start < current.length) {
    const before = String.fromCodePoint(previous.codePointAt(start));
    if (before !== String.fromCodePoint(current.codePointAt(start))) break;
    start += before.length;
  }
  let priorEnd = previous.length;
  let currentEnd = current.length;
  while (priorEnd > start && currentEnd > start) {
    const previousWidth = isLowSurrogate(previous.charCodeAt(priorEnd - 1))
      ? 2
      : 1;
    const currentWidth = isLowSurrogate(current.charCodeAt(currentEnd - 1))
      ? 2
      : 1;
    if (
      previous.slice(priorEnd - previousWidth, priorEnd) !==
      current.slice(currentEnd - currentWidth, currentEnd)
    ) break;
    priorEnd -= previousWidth;
    currentEnd -= currentWidth;
  }
  return { start, end: currentEnd };
}

// Prior snapshots are OPTIONAL, and MUST come from trusted server-side
// historical records. Each snapshot is tied to the acknowledged analysis hash;
// an unverified/mismatched history fails closed instead of shaping prompts.
function checkedHistoricalEpisodes(previousEpisodes, episodes, analyses, novelId) {
  if (
    !Array.isArray(previousEpisodes) ||
    previousEpisodes.length > episodes.length
  ) invalid();
  const currentIds = new Set(episodes.map((item) => Number(item.id)));
  const analysisHashes = new Map(
    analyses.map((row) => [Number(row.episode_id), row.source_hash])
  );
  const historical = new Map();
  for (const old of previousEpisodes) {
    const episodeId = Number(old?.id);
    if (
      !validId(episodeId) ||
      !/^[1-9]\\d*$/.test(String(old.id)) ||
      Number(old.novel_id) !== novelId ||
      !/^[1-9]\\d*$/.test(String(old.novel_id)) ||
      !currentIds.has(episodeId) ||
      historical.has(episodeId) ||
      typeof old.title !== 'string' ||
      typeof old.content !== 'string' ||
      Buffer.byteLength(old.title, 'utf8') > 8192 ||
      Buffer.byteLength(old.content, 'utf8') > 1000000 ||
      analysisHashes.get(episodeId) !==
        sha256(JSON.stringify([old.title, old.content]))
    ) invalid();
    ensureUnicodeScalar(old.content);
    historical.set(episodeId, old);
  }
  return historical;
}

// Metadata-only queue: no chapter titles, bodies, notes or raw quotations.
// A title-only revision deliberately invalidates the whole chapter hash.
// With no verified historical text, the entire changed episode is selected.
// With verified historical text, only the minimal changed excerpt is selected.
export function planNovelBibleChangedChunks({
  principal,
  novel,
  episodes,
  analyses,
  limit = 12,
  previousEpisodes = []
}) {
  const base = planNovelBibleEpisodeChanges({
    principal,
    novel,
    episodes,
    analyses,
    limit
  });
  const byId = new Map();
  for (const episode of episodes) {
    byId.set(Number(episode.id), episode);
  }
  const historical = checkedHistoricalEpisodes(
    previousEpisodes, episodes, analyses, base.novelId
  );
  const chunks = [];
  const emptyChangedEpisodes = [];
  const deletionOnlyEpisodes = [];
  for (const item of base.pending) {
    const episode = byId.get(item.episodeId);
    if (!episode) invalid();
    const { episodeId, sourceHash, reason } = item;
    const old = historical.get(episodeId);
    let text = episode.content;
    let offset = 0;
    if (reason === 'changed' && old && old.title === episode.title) {
      const window = changedWindow(old.content, episode.content);
      text = episode.content.slice(window.start, window.end);
      offset = window.start;
      if (text.length === 0 && episode.content.length > 0) {
        deletionOnlyEpisodes.push(episodeId);
        continue;
      }
    }
    const parts = segments(text, episodeId, sourceHash, reason, offset);
    if (!parts.length) emptyChangedEpisodes.push(item.episodeId);
    chunks.push(...parts);
  }
  return {
    novelId: base.novelId,
    totalEpisodes: base.totalEpisodes,
    unchangedCount: base.unchangedCount,
    deferredEpisodeCount: base.deferredCount,
    emptyChangedEpisodes,
    deletionOnlyEpisodes,
    chunks
  };
}

// Materialization is deliberate and bounded: recheck the entire current
// chapter hash, owner and work on every request. NEVER call from a public
// route without separately verifying the trusted server-side session.
export function materializeNovelBibleChunk({
  principal,
  novel,
  episode,
  chunk
}) {
  const current = planNovelBibleEpisodeChanges({
    principal,
    novel,
    episodes: [episode],
    analyses: [],
    limit: 1
  });
  const currentHash = current.pending[0]?.sourceHash;
  if (
    !chunk ||
    typeof chunk !== 'object' ||
    Array.isArray(chunk) ||
    !validId(chunk.episodeId) ||
    chunk.episodeId !== Number(episode.id) ||
    !HASH.test(chunk.sourceHash) ||
    chunk.sourceHash !== currentHash ||
    !['new', 'changed'].includes(chunk.reason) ||
    !Number.isSafeInteger(chunk.start) ||
    !Number.isSafeInteger(chunk.end) ||
    chunk.start < 0 ||
    chunk.end <= chunk.start ||
    chunk.end > episode.content.length ||
    !Number.isSafeInteger(chunk.byteLength) ||
    chunk.byteLength < 1 ||
    chunk.byteLength > MAX_CHUNK_BYTES ||
    typeof chunk.chunkHash !== 'string' ||
    !HASH.test(chunk.chunkHash)
  ) {
    invalid();
  }
  ensureUnicodeScalar(episode.content);
  const startCode = episode.content.charCodeAt(chunk.start);
  const endCode = episode.content.charCodeAt(chunk.end);
  if (isLowSurrogate(startCode) || isLowSurrogate(endCode)) invalid();
  const text = episode.content.slice(chunk.start, chunk.end);
  if (
    Buffer.byteLength(text, 'utf8') !== chunk.byteLength ||
    sha256(text) !== chunk.chunkHash
  ) {
    invalid();
  }
  return {
    novelId: current.novelId,
    episodeId: chunk.episodeId,
    sourceHash: currentHash,
    chunkHash: chunk.chunkHash,
    text
  };
}
