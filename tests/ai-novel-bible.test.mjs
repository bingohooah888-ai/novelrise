import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupNovelBibleFacts,
  planNovelBibleEpisodeChanges
} from '../api/_lib/ai/novel-bible.js';

const author = { id: 'author-1' };
const novel = { id: 41, user_id: 'author-1' };

function episode(id, title, content, order = id) {
  return { id, novel_id: 41, title, content, order_index: order };
}

function plan(extra = {}) {
  return planNovelBibleEpisodeChanges({
    principal: author,
    novel,
    episodes: [
      episode(10, '第一話', '秘密の城'),
      episode(11, '第二話', '冬の街')
    ],
    analyses: [],
    ...extra
  });
}

function fact(id, provenance, payload, novelId = 41) {
  return {
    id,
    novel_id: novelId,
    source_episode_id: 10,
    fact_kind: 'character',
    fact_key: 'hero-name',
    fact_payload: payload,
    provenance,
    revision: 1
  };
}

test('Novel Bible updates only new and changed chapters without returning text', () => {
  const initial = plan();
  assert.deepEqual(
    initial.pending.map((x) => x.reason),
    ['new', 'new']
  );
  assert.deepEqual(
    initial.pending.map((x) => x.episodeId),
    [10, 11]
  );
  assert.equal(initial.pending[0].sourceHash.length, 64);
  assert.doesNotMatch(JSON.stringify(initial), /秘密の城|冬の街/);

  const unchanged = plan({
    analyses: [
      { episode_id: 10, source_hash: initial.pending[0].sourceHash },
      { episode_id: 11, source_hash: initial.pending[1].sourceHash }
    ]
  });
  assert.deepEqual(unchanged.pending, []);
  assert.equal(unchanged.unchangedCount, 2);

  const revised = plan({
    episodes: [
      episode(10, '第一話', '秘密の城'),
      episode(11, '第二話', '新しい街')
    ],
    analyses: [
      { episode_id: 10, source_hash: initial.pending[0].sourceHash },
      { episode_id: 11, source_hash: initial.pending[1].sourceHash }
    ]
  });
  assert.deepEqual(
    revised.pending.map((x) => [x.episodeId, x.reason]),
    [[11, 'changed']]
  );
});

test('Novel Bible batches deterministically and never sends content to a model', () => {
  const planned = plan({
    episodes: [
      episode(3, 'Third', 'c', 3),
      episode(1, 'First', 'a', 1),
      episode(2, 'Second', 'b', 2)
    ],
    limit: 2
  });
  assert.deepEqual(
    planned.pending.map((x) => x.episodeId),
    [1, 2]
  );
  assert.equal(planned.deferredCount, 1);
  assert.equal(planned.totalEpisodes, 3);
});

test('Novel Bible fails closed on other authors and cross-work data', () => {
  assert.throws(
    () => plan({ principal: { id: 'attacker' } }),
    /AI_ACCESS_DENIED/
  );
  assert.throws(
    () =>
      plan({
        episodes: [
          episode(1, 'Safe', 'text'),
          { ...episode(2, 'Other', 'secret'), novel_id: 99 }
        ]
      }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(
    () => plan({ episodes: [episode(1, 'One', 'x'), episode(1, 'One', 'x')] }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(
    () => plan({ analyses: [{ episode_id: 99, source_hash: 'a'.repeat(64) }] }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(
    () => plan({ analyses: [{ episode_id: 10, source_hash: 'bad' }] }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
  assert.throws(() => plan({ limit: 0 }), /AI_NOVEL_BIBLE_INVALID_SOURCE/);
  assert.throws(() => plan({ limit: 31 }), /AI_NOVEL_BIBLE_INVALID_SOURCE/);
});

test('confirmed author canon remains separate from AI suggestions', () => {
  const facts = [
    fact(2, 'ai_inferred', { name: 'Suspected fake name' }),
    fact(1, 'author_confirmed', { name: 'Real author name' })
  ];
  const view = groupNovelBibleFacts({ principal: author, novel, facts });
  assert.equal(view.novelId, 41);
  assert.equal(view.groups.length, 1);
  assert.deepEqual(
    view.groups[0].confirmed.map((x) => x.id),
    [1]
  );
  assert.deepEqual(
    view.groups[0].suggestions.map((x) => x.id),
    [2]
  );
  assert.equal(view.groups[0].confirmed[0].payload.name, 'Real author name');
  assert.equal(view.groups[0].needsAuthorReview, true);
  assert.deepEqual(facts[0].fact_payload, { name: 'Suspected fake name' });
});

test('multiple conflicting author-confirmed facts are preserved for review', () => {
  const view = groupNovelBibleFacts({
    principal: author,
    novel,
    facts: [
      fact(7, 'author_confirmed', { age: 18 }),
      fact(4, 'author_confirmed', { age: 19 })
    ]
  });
  assert.equal(view.groups[0].confirmed.length, 2);
  assert.deepEqual(
    view.groups[0].confirmed.map((x) => x.id),
    [4, 7]
  );
  assert.equal(view.groups[0].needsAuthorReview, true);
});

test('Novel Bible blocks provenance forgery and unrelated private facts', () => {
  assert.throws(
    () =>
      groupNovelBibleFacts({
        principal: { id: 'reader-2' },
        novel,
        facts: [fact(1, 'author_confirmed', { answer: 42 })]
      }),
    /AI_ACCESS_DENIED/
  );
  for (const facts of [
    [fact(1, 'author_confirmed', { secret: true }, 99)],
    [fact(1, 'fake_ai', { secret: true })],
    [fact(1, 'author_confirmed', ['not object'])],
    [
      fact(1, 'author_confirmed', { ok: true }),
      fact(1, 'ai_inferred', { ok: false })
    ]
  ]) {
    assert.throws(
      () => groupNovelBibleFacts({ principal: author, novel, facts }),
      /AI_NOVEL_BIBLE_INVALID_SOURCE/
    );
  }
});

test('no AI calls, money, database writes, or public endpoints are required', () => {
  const one = plan({ episodes: [episode(1, 'New', 'Only in memory')] });
  assert.deepEqual(Object.keys(one).sort(), [
    'deferredCount',
    'novelId',
    'pending',
    'totalEpisodes',
    'unchangedCount'
  ]);
  const empty = groupNovelBibleFacts({ principal: author, novel, facts: [] });
  assert.deepEqual(empty.groups, []);
});

test('title-only edits and appended episodes do not replay old chapters', () => {
  const initial = plan();
  const analyses = initial.pending.map(({ episodeId, sourceHash }) => ({
    episode_id: episodeId,
    source_hash: sourceHash
  }));
  const updated = plan({
    episodes: [
      episode(10, '第一話・改題', '秘密の城'),
      episode(11, '第二話', '冬の街'),
      episode(12, '第三話', '新しい出会い')
    ],
    analyses
  });
  assert.deepEqual(
    updated.pending.map(({ episodeId, reason }) => [episodeId, reason]),
    [
      [10, 'changed'],
      [12, 'new']
    ]
  );
  assert.equal(updated.unchangedCount, 1);
  assert.equal(updated.deferredCount, 0);
});

function rejectsInvalidSource(run) {
  assert.throws(run, /AI_NOVEL_BIBLE_INVALID_SOURCE/);
}

test('noncanonical IDs and invalid episode metadata fail closed', () => {
  const base = episode(10, 'Safe', 'body');
  const invalidIds = [
    true,
    [10],
    '1e1',
    '10.0',
    ' 10',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ];
  for (const id of invalidIds) {
    rejectsInvalidSource(() => plan({ episodes: [{ ...base, id }] }));
  }
  const invalidRows = [
    { novel_id: true },
    { title: null },
    { title: 'x'.repeat(8193) },
    { content: null },
    { content: { body: 'not text' } },
    { order_index: true },
    { order_index: -1 },
    { order_index: '1e1' }
  ];
  for (const changes of invalidRows) {
    const broken = { ...base, ...changes };
    rejectsInvalidSource(() => plan({ episodes: [broken] }));
  }
});

test('duplicate analyses and invalid hashes or sources fail closed', () => {
  const initial = plan();
  const existing = {
    episode_id: 10,
    source_hash: initial.pending[0].sourceHash
  };
  const invalidRows = [
    [existing, existing],
    [{ ...existing, source_hash: existing.source_hash.toUpperCase() }],
    [{ ...existing, episode_id: true }],
    [{ ...existing, episode_id: 99 }]
  ];
  for (const analyses of invalidRows) {
    rejectsInvalidSource(() => plan({ analyses }));
  }
  const overlong = episode(10, 'x', 'y'.repeat(1000001));
  rejectsInvalidSource(() => plan({ episodes: [overlong] }));
});

test('all fact kinds stay separate and malformed fact records fail closed', () => {
  const kinds = [
    'character',
    'relationship',
    'location',
    'world',
    'timeline',
    'event',
    'foreshadowing',
    'other'
  ];
  const facts = kinds.map((kind, index) => ({
    ...fact(index + 1, 'author_confirmed', { statement: kind }),
    fact_kind: kind,
    fact_key: kind
  }));
  const grouped = groupNovelBibleFacts({ principal: author, novel, facts });
  assert.deepEqual(
    grouped.groups.map((group) => group.kind).sort(),
    [...kinds].sort()
  );
  assert.ok(grouped.groups.every((group) => !group.suggestions.length));
  assert.ok(grouped.groups.every((group) => !group.needsAuthorReview));

  const invalidFields = [
    { id: true },
    { id: '1e0' },
    { source_episode_id: [10] },
    { fact_key: '' },
    { revision: 0 },
    { revision: '1' },
    { fact_payload: { oversized: 'x'.repeat(8193) } }
  ];
  for (const changes of invalidFields) {
    const broken = {
      ...fact(1, 'author_confirmed', { ok: true }),
      ...changes
    };
    rejectsInvalidSource(() => {
      groupNovelBibleFacts({ principal: author, novel, facts: [broken] });
    });
  }
});

test('offline planning makes no network request and does not mutate inputs', () => {
  const previousFetch = globalThis.fetch;
  const episodes = [episode(10, 'Safe title', 'Unpublished draft')];
  const facts = [fact(1, 'author_confirmed', { name: 'Author canon' })];
  const snapshots = JSON.stringify({ episodes, facts });
  globalThis.fetch = () => {
    throw new Error('OFFLINE_ONLY_NETWORK_CALL');
  };
  try {
    plan({ episodes });
    groupNovelBibleFacts({ principal: author, novel, facts });
    assert.equal(JSON.stringify({ episodes, facts }), snapshots);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
