import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
await import(new URL('novelight-natural-search.js', root));
const naturalSearch = globalThis.NovelightNaturalSearch;

test('natural query builds an explainable bounded plan', () => {
  const plan = naturalSearch.buildPlan('泣ける恋愛を読みたい');
  assert.equal(plan.genre, '恋愛');
  assert.equal(plan.genreSource, 'inferred');
  assert.ok(plan.terms.length > 0);
  assert.ok(plan.terms.length <= 6);
  assert.ok(plan.terms.some((entry) => entry.label === '感動'));
});

test('explicit genre selection wins over inferred genre', () => {
  const plan = naturalSearch.buildPlan('恋愛要素のある冒険が読みたい', 'SF');
  assert.equal(plan.genre, 'SF');
  assert.equal(plan.genreSource, 'selected');
});

test('official tag aliases resolve to one stable tag and ASCII aliases use token boundaries', () => {
  const catalog = [
    {
      id: 'yuri_gl',
      displayName: '百合／GL',
      aliases: ['百合', 'GL', 'ガールズラブ']
    },
    {
      id: 'sf',
      displayName: 'SF',
      aliases: ['SF']
    }
  ];
  const yuri = naturalSearch.buildPlan(
    'ガールズラブの異世界作品が読みたい',
    '',
    catalog
  );
  assert.deepEqual(
    yuri.officialTags.map((tag) => tag.id),
    ['yuri_gl']
  );

  const noFalsePositive = naturalSearch.buildPlan(
    'single route の話',
    '',
    catalog
  );
  assert.deepEqual(noFalsePositive.officialTags, []);
});

test('ranking is deterministic and exposes match reasons', () => {
  const plan = {
    genre: 'SF',
    terms: [
      { term: '宇宙', label: '宇宙', kind: 'direct' },
      { term: '冒険', label: '冒険', kind: 'related' }
    ]
  };
  const rows = naturalSearch.rankRows(
    [
      {
        novel_id: 'b',
        title: '宇宙航路',
        description: '仲間との冒険',
        genre: 'SF',
        created_at: '2026-09-18T00:00:00Z'
      },
      {
        novel_id: 'a',
        title: '静かな星',
        description: '宇宙を旅する物語',
        genre: 'SF',
        created_at: '2026-09-19T00:00:00Z'
      }
    ],
    plan,
    24
  );
  assert.equal(rows[0].novel_id, 'b');
  assert.ok(rows[0].natural_match_score > rows[1].natural_match_score);
  assert.ok(
    rows[0].natural_match_reasons.some((reason) => reason.includes('宇宙'))
  );
});
test('search only uses existing neutral public search RPC and bounded calls', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [
          {
            novel_id: String(calls.length),
            title: args.p_keyword || '恋愛',
            description: '感動する物語',
            genre: args.p_genre || '恋愛',
            created_at: '2026-09-19T00:00:00Z'
          }
        ],
        error: null
      };
    }
  };

  const result = await naturalSearch.search(client, '泣ける恋愛を読みたい', {
    limit: 24
  });
  assert.ok(result.rows.length > 0);
  assert.ok(calls.length <= 7);
  assert.ok(calls.every((call) => call.name === 'novelight_neutral_search'));
  assert.ok(calls.every((call) => call.args.p_sort === 'new'));
  assert.ok(calls.some((call) => call.args.p_genre === '恋愛'));
  assert.ok(calls.some((call) => call.args.p_genre === null));
});
test('natural search uses canonical official tag ids when a tag alias is inferred', async () => {
  const previousTags = globalThis.NovelightTags;
  Object.defineProperty(globalThis, 'NovelightTags', {
    configurable: true,
    value: {
      async loadCatalog() {
        return [
          {
            id: 'yuri_gl',
            displayName: '百合／GL',
            aliases: ['百合', 'GL', 'ガールズラブ']
          }
        ];
      },
      isMissingRpc() {
        return false;
      }
    }
  });

  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [
          {
            novel_id: 'tagged',
            title: '静かな旅',
            description: '二人の冒険',
            genre: '異世界ファンタジー',
            official_tag_ids: ['yuri_gl'],
            created_at: '2026-09-19T00:00:00Z'
          }
        ],
        error: null
      };
    }
  };

  try {
    const result = await naturalSearch.search(
      client,
      '百合の異世界ファンタジーが読みたい',
      { limit: 24 }
    );
    assert.ok(result.rows.length > 0);
    assert.ok(
      calls.some(
        (call) =>
          call.name === 'novelight_neutral_search_v2' &&
          call.args.p_official_tag_ids.includes('yuri_gl')
      )
    );
  } finally {
    if (previousTags === undefined) delete globalThis.NovelightTags;
    else {
      Object.defineProperty(globalThis, 'NovelightTags', {
        configurable: true,
        value: previousTags
      });
    }
  }
});

test('search page keeps existing discovery and safety contracts', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('search.html', root), 'utf8'),
    readFile(new URL('novelight-natural-search.js', root), 'utf8')
  ]);
  assert.match(html, /自然文で探す/);
  assert.match(html, /novelight-natural-search\.js/);
  assert.match(html, /novelight-tags\.js/);
  assert.match(html, /公式タグで絞り込む/);
  assert.match(html, /AND検索/);
  assert.match(html, /novelight_neutral_search_v2/);
  assert.match(html, /NovelightNaturalSearch\.search/);
  assert.match(html, /NovelightUserSafety\.filterNovelRows/);
  assert.match(html, /novelight_trusted_discovery_feed/);
  assert.match(html, /recordNeutralSearchImpressions/);
  assert.match(html, /作品Rankや課金プランは関連度に加点しません/);
  assert.match(html, /sort\.disabled=naturalMode/);

  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.doesNotMatch(script, /openai|embedding|vector/i);
  assert.match(script, /novelight_neutral_search/);
});
