import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  materializeNovelBibleChunk,
  planNovelBibleChangedChunks
} from '../api/_lib/ai/novel-bible-chunks.js';
import { createOwnerNovelBibleVerifiedHistoryReader } from '../api/_lib/ai/owner-novel-bible-verified-history.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BEFORE = '凛は赤い鍵を持っていた。';
const CURRENT = '凛は青い鍵を持っていた。';
const NOW = Date.parse('2026-11-15T00:00:00.000Z');

function sourceHash(content) {
  return createHash('sha256')
    .update(JSON.stringify(['第一話', content]))
    .digest('hex');
}

function fixture({
  before = BEFORE,
  current = CURRENT,
  analysis = true,
  novelOwner = OWNER,
  episodeOwner = OWNER,
  revisionOwner = OWNER,
  revisionText = before,
  revisionDate = '2026-11-14T00:00:00.000Z',
  badAnalysis = false
} = {}) {
  const calls = [];
  const episode = {
    id: 11,
    novel_id: 41,
    user_id: episodeOwner,
    title: '第一話',
    content: current
  };
  const revision = {
    id: '33333333-3333-4333-8333-333333333333',
    episode_id: 11,
    novel_id: 41,
    user_id: revisionOwner,
    title: '第一話',
    content: revisionText,
    created_at: revisionDate
  };
  const serviceClient = {
    from(table) {
      calls.push(['from', table]);
      return {
        select() {
          return this;
        },
        eq(key, value) {
          calls.push(['eq', table, key, value]);
          return this;
        },
        order() {
          return this;
        },
        limit(count) {
          assert.equal(table, 'episode_revisions');
          assert.equal(count, 20);
          return { data: [revision], error: null };
        },
        async maybeSingle() {
          if (table === 'novels') {
            return {
              data: { id: 41, user_id: novelOwner },
              error: null
            };
          }
          if (table === 'episodes') {
            return { data: episode, error: null };
          }
          if (table === 'novelight_ai_episode_analysis') {
            return {
              data: analysis
                ? {
                    episode_id: badAnalysis ? 12 : 11,
                    source_hash: sourceHash(before),
                    revision: 1
                  }
                : null,
              error: null
            };
          }
          throw new Error('UNEXPECTED_TABLE');
        }
      };
    }
  };
  const read = createOwnerNovelBibleVerifiedHistoryReader({
    serviceClient,
    nowEpochSeconds: () => NOW / 1000
  });
  return {
    calls,
    episode,
    read: () => read({ actorId: OWNER, novelId: 41, episodeId: 11 })
  };
}

test('authoritative checkpoint plus private revision selects only verified changed text', async () => {
  const f = fixture();
  const history = await f.read();
  assert.equal(history.episode.content, BEFORE);
  const principal = { id: OWNER };
  const novel = { id: 41, user_id: OWNER };
  const plan = planNovelBibleChangedChunks({
    principal,
    novel,
    episodes: [f.episode],
    analyses: [history.analysis],
    previousEpisodes: [history.episode],
    limit: 1
  });
  assert.equal(plan.chunks.length, 1);
  assert.equal(
    materializeNovelBibleChunk({
      principal,
      novel,
      episode: f.episode,
      chunk: plan.chunks[0]
    }).text,
    '青'
  );
  assert.ok(
    f.calls.some(
      ([op, table, key, value]) =>
        op === 'eq' &&
        table === 'episode_revisions' &&
        key === 'user_id' &&
        value === OWNER
    )
  );
});

test('no completed analysis returns null; unchanged analysis avoids revision query', async () => {
  const absent = fixture({ analysis: false });
  assert.equal(await absent.read(), null);
  assert.equal(
    absent.calls.some((call) => call[1] === 'episode_revisions'),
    false
  );
  const same = fixture({ before: CURRENT, current: CURRENT });
  const result = await same.read();
  assert.equal(result.analysis.source_hash, sourceHash(CURRENT));
  assert.equal(result.episode, undefined);
  assert.equal(
    same.calls.some((call) => call[1] === 'episode_revisions'),
    false
  );
});

test('missing or expired matching history falls back without trusting a guessed old body', async () => {
  for (const options of [
    { revisionText: '無関係な過去の本文' },
    { revisionDate: '2026-07-01T00:00:00.000Z' }
  ]) {
    const f = fixture(options);
    const result = await f.read();
    assert.equal(result.analysis.source_hash, sourceHash(BEFORE));
    assert.equal(result.episode, undefined);
    const plan = planNovelBibleChangedChunks({
      principal: { id: OWNER },
      novel: { id: 41, user_id: OWNER },
      episodes: [f.episode],
      analyses: [result.analysis],
      previousEpisodes: [],
      limit: 1
    });
    const part = materializeNovelBibleChunk({
      principal: { id: OWNER },
      novel: { id: 41, user_id: OWNER },
      episode: f.episode,
      chunk: plan.chunks[0]
    });
    assert.equal(part.text, CURRENT);
  }
});

test('wrong novel, episode owner, revision owner and malformed checkpoint fail closed', async () => {
  for (const options of [
    { novelOwner: OTHER },
    { episodeOwner: OTHER },
    { revisionOwner: OTHER },
    { badAnalysis: true }
  ]) {
    const f = fixture(options);
    await assert.rejects(f.read(), /AI_BIBLE_HISTORY_UNAVAILABLE/u);
  }
});

test('reader construction and unscoped calls reject before any database read', async () => {
  assert.throws(
    () => createOwnerNovelBibleVerifiedHistoryReader(),
    /AI_BIBLE_HISTORY_UNAVAILABLE/u
  );
  let count = 0;
  const read = createOwnerNovelBibleVerifiedHistoryReader({
    serviceClient: {
      from() {
        count += 1;
        throw new Error('UNEXPECTED');
      }
    }
  });
  await assert.rejects(
    read({ actorId: OTHER, novelId: 0, episodeId: 11 }),
    /AI_BIBLE_HISTORY_UNAVAILABLE/u
  );
  assert.equal(count, 0);
});
