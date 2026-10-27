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
function segments(content, episodeId, sourceHash, reason) {
  ensureUnicodeScalar(content);
  const items = [];
  let start = 0;
  let bytes = 0;
  for (let pos = 0; pos < content.length; ) {
    const symbol = String.fromCodePoint(content.codePointAt(pos));
    const symbolBytes = Buffer.byteLength(symbol, 'utf8');
    if (bytes + symbolBytes > MAX_CHUNK_BYTES) {
      const text = content.slice(start, pos);
      items.push({
        episodeId,
        sourceHash,
        reason,
        start,
        end: pos,
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
      start,
      end: content.length,
      byteLength: bytes,
      chunkHash: sha256(content.slice(start))
    });
  }
  return items;
}

// Metadata-only queue: no chapter titles, bodies, notes or raw quotations.
// A title-only revision deliberately invalidates the whole chapter hash.
// It cannot compute changed paragraphs without retaining prior manuscript text.
export function planNovelBibleChangedChunks({
  principal,
  novel,
  episodes,
  analyses,
  limit = 12
}) {
  const base = planNovelBibleEpisodeChanges({
    principal,
    novel,
    episodes,
    analyses,
    limit
  });
  const byId = new Map(
    episodes.map((episode) => [Number(episode.id), episode])
  );
  const chunks = [];
  const emptyChangedEpisodes = [];
  for (const item of base.pending) {
    const episode = byId.get(item.episodeId);
    if (!episode) invalid();
    const parts = segments(
      episode.content,
      item.episodeId,
      item.sourceHash,
      item.reason
    );
    if (!parts.length) emptyChangedEpisodes.push(item.episodeId);
    chunks.push(...parts);
  }
  return {
    novelId: base.novelId,
    totalEpisodes: base.totalEpisodes,
    unchangedCount: base.unchangedCount,
    deferredEpisodeCount: base.deferredCount,
    emptyChangedEpisodes,
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
