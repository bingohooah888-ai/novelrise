import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  materializeNovelBibleChunk,
  planNovelBibleChangedChunks
} from '../api/_lib/ai/novel-bible-chunks.js';

const principal = { id: 'owner-1' };
const novel = { id: 41, user_id: 'owner-1' };

function episode(id, content, order = id, title = '第' + id + '話') {
  return { id, novel_id: 41, order_index: order, title, content };
}

function plan(episodes, extra = {}) {
  return planNovelBibleChangedChunks({
    principal,
    novel,
    episodes,
    analyses: [],
    ...extra
  });
}

test('02-07-02 indexes only changed or new chapters without raw text', () => {
  const chapters = [
    episode(2, 'KEEP PRIVATE: secret setting', 2),
    episode(1, '未公開の第一話', 1)
  ];
  const initial = plan(chapters);
  const hashes = new Map(
    initial.chunks.map((chunk) => [chunk.episodeId, chunk.sourceHash])
  );
  const revised = plan(
    [chapters[0], episode(1, '改稿された第一話', 1), episode(3, '新章', 3)],
    {
      analyses: [{ episode_id: 2, source_hash: hashes.get(2) }]
    }
  );
  assert.deepEqual(
    revised.chunks.map((chunk) => [chunk.episodeId, chunk.reason]),
    [
      [1, 'new'],
      [3, 'new']
    ]
  );
  assert.equal(revised.unchangedCount, 1);
  assert.doesNotMatch(
    JSON.stringify(revised),
    /改稿された第一話|KEEP PRIVATE|新章/
  );
});

test('changed revision skips unchanged chapters and stays ordered', () => {
  const old = plan([episode(1, '旧本文'), episode(2, '保存済み')]);
  const hashes = old.chunks.map((chunk) => ({
    episode_id: chunk.episodeId,
    source_hash: chunk.sourceHash
  }));
  const revised = plan([episode(2, '保存済み'), episode(1, '新本文')], {
    analyses: hashes
  });
  assert.equal(revised.unchangedCount, 1);
  assert.deepEqual(
    revised.chunks.map((chunk) => [chunk.episodeId, chunk.reason]),
    [[1, 'changed']]
  );
});

test('Unicode and Japanese text split into bounded complete segments', () => {
  const text = '漢字🌸かな'.repeat(1300);
  const e = episode(9, text);
  const result = plan([e]);
  assert.ok(result.chunks.length > 2);
  const fragments = result.chunks.map((chunk) => {
    assert.ok(chunk.byteLength <= 4096);
    assert.match(chunk.chunkHash, /^[a-f0-9]{64}$/);
    return materializeNovelBibleChunk({
      principal,
      novel,
      episode: e,
      chunk
    }).text;
  });
  assert.equal(fragments.join(''), text);
  assert.doesNotMatch(JSON.stringify(result), /漢字|かな|🌸/);
});

test('owner checks, stale chapters and forged segments fail closed', () => {
  const e = episode(1, '🌸秘密の設定' + 'あ'.repeat(2000));
  const chunk = plan([e]).chunks[0];
  const read = (overrides = {}) =>
    materializeNovelBibleChunk({
      principal,
      novel,
      episode: e,
      chunk,
      ...overrides
    });
  assert.throws(
    () => read({ principal: { id: 'someone-else' } }),
    /AI_ACCESS_DENIED/
  );
  assert.throws(
    () => read({ episode: { ...e, novel_id: 999 } }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(
    () => read({ episode: { ...e, content: e.content + '修正' } }),
    /AI_BIBLE_CHUNK_INVALID/
  );
  const halfEmoji = e.content.slice(0, 1);
  const forgedChunk = { ...chunk, end: 1 };
  forgedChunk.byteLength = Buffer.byteLength(halfEmoji, 'utf8');
  forgedChunk.chunkHash = createHash('sha256').update(halfEmoji).digest('hex');
  const cases = [
    { ...chunk, episodeId: 99 },
    { ...chunk, end: e.content.length + 1 },
    { ...chunk, byteLength: 5000 },
    { ...chunk, chunkHash: '0'.repeat(64) },
    { ...chunk, sourceHash: '0'.repeat(64) },
    { ...chunk, reason: 'confirmed' },
    forgedChunk
  ];
  for (const candidate of cases) {
    assert.throws(() => read({ chunk: candidate }), /AI_BIBLE_CHUNK_INVALID/);
  }
});

test('empty chapters, deferred items and read-only guard', () => {
  const chapters = [episode(4, ''), episode(3, 'alpha'), episode(2, 'beta')];
  const frozen = JSON.stringify(chapters);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('OFFLINE_ONLY');
  };
  try {
    const result = plan(chapters, { limit: 2 });
    assert.equal(result.deferredEpisodeCount, 1);
    assert.deepEqual(result.emptyChangedEpisodes, []);
    assert.deepEqual(
      result.chunks.map((x) => x.episodeId),
      [2, 3]
    );
    assert.equal(JSON.stringify(chapters), frozen);
    const empty = plan([episode(1, '')]);
    assert.deepEqual(empty.emptyChangedEpisodes, [1]);
    assert.deepEqual(empty.chunks, []);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('reject invalid owners, cross-work rows and malformed Unicode', () => {
  assert.throws(
    () => plan([episode(1, 'private')], { principal: { id: 'other' } }),
    /AI_ACCESS_DENIED/
  );
  assert.throws(
    () => plan([{ ...episode(1, 'private'), novel_id: 20 }]),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(
    () => plan([episode(1, 'broken\uD800sequence')]),
    /AI_BIBLE_CHUNK_INVALID/
  );
});

test('verified historical snapshots restrict changed excerpts to the new text', () => {
  const before = episode(7, '序章🌸旧⏰終章');
  const after = episode(7, '序章🌸新✨終章');
  const oldHash = createHash('sha256')
    .update(JSON.stringify([before.title, before.content]))
    .digest('hex');
  const result = plan([after], {
    analyses: [{ episode_id: 7, source_hash: oldHash }],
    previousEpisodes: [before]
  });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].reason, 'changed');
  assert.deepEqual(result.deletionOnlyEpisodes, []);
  assert.equal(
    materializeNovelBibleChunk({
      principal,
      novel,
      episode: after,
      chunk: result.chunks[0]
    }).text,
    '新✨'
  );
  assert.ok(result.chunks[0].start > 0);
  assert.doesNotMatch(JSON.stringify(result), /序章|旧|終章|新/u);
});

test('long insertions use bounded global offsets and preserve Unicode', () => {
  const before = episode(8, '共通🌸結末');
  const inserted = '新🌸'.repeat(900);
  const after = episode(8, '共通🌸' + inserted + '結末');
  const oldHash = createHash('sha256')
    .update(JSON.stringify([before.title, before.content]))
    .digest('hex');
  const result = plan([after], {
    analyses: [{ episode_id: 8, source_hash: oldHash }],
    previousEpisodes: [before]
  });
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((part) => part.byteLength <= 4096));
  assert.equal(
    result.chunks
      .map(
        (chunk) =>
          materializeNovelBibleChunk({
            principal,
            novel,
            episode: after,
            chunk
          }).text
      )
      .join(''),
    inserted
  );
});

test('deletion-only changes avoid sending unchanged text to a model', () => {
  const before = episode(9, '冒頭🌸削除された内容。結末');
  const after = episode(9, '冒頭🌸結末');
  const oldHash = createHash('sha256')
    .update(JSON.stringify([before.title, before.content]))
    .digest('hex');
  const result = plan([after], {
    analyses: [{ episode_id: 9, source_hash: oldHash }],
    previousEpisodes: [before]
  });
  assert.deepEqual(result.deletionOnlyEpisodes, [9]);
  assert.deepEqual(result.chunks, []);
  assert.deepEqual(result.emptyChangedEpisodes, []);
});

test('untrusted historical revisions fail closed; missing history falls back', () => {
  const before = episode(10, '過去の本文');
  const after = episode(10, '変更後の本文');
  const oldHash = createHash('sha256')
    .update(JSON.stringify([before.title, before.content]))
    .digest('hex');
  const analyses = [{ episode_id: 10, source_hash: oldHash }];
  const fallback = plan([after], { analyses });
  assert.equal(
    materializeNovelBibleChunk({
      principal,
      novel,
      episode: after,
      chunk: fallback.chunks[0]
    }).text,
    after.content
  );
  for (const historical of [
    [{ ...before, novel_id: 99 }],
    [{ ...before, content: '異なる過去' }],
    [{ ...before, content: '破損' + String.fromCharCode(0xd800) }],
    [before, before]
  ]) {
    assert.throws(
      () => plan([after], { analyses, previousEpisodes: historical }),
      /AI_BIBLE_CHUNK_INVALID/u
    );
  }
});
