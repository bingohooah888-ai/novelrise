import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

async function loadMixer(hidden = false) {
  const source = await readFile(
    new URL('../novelight-r15-discovery.js', import.meta.url),
    'utf8'
  );
  const context = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} },
    localStorage: { getItem() { return hidden ? '1' : null; } },
    console: { error() {}, warn() {} },
    URL
  };
  runInNewContext(source, context);
  return context.window.NovelightR15;
}

function makeClient(rows) {
  const ratings = new Map(
    rows.map((row) => [String(row.novel_id), row.content_rating])
  );
  const batches = [];
  return {
    batches,
    async rpc(name, args) {
      assert.equal(name, 'novelight_search_card_metadata');
      assert.ok(args.p_novel_ids.length <= 50);
      batches.push(args.p_novel_ids);
      return {
        data: args.p_novel_ids.map((id) => ({
          novel_id: id,
          content_rating: ratings.get(id)
        }))
      };
    }
  };
}

test('recommendations cap R15 at one third when general works are available', async () => {
  const mix = await loadMixer();
  const rows = Array.from({ length: 12 }, (_, i) => ({
    novel_id: String(i + 1),
    content_rating: 'sensitive_15'
  })).concat(
    Array.from({ length: 24 }, (_, i) => ({
      novel_id: String(100 + i),
      content_rating: 'general'
    }))
  );
  const client = makeClient(rows);
  const inputs = rows.map(({ novel_id }) => ({ novel_id }));
  const result = await mix.mixRecommendedRows(inputs, client);
  assert.equal(result.length, rows.length);
  const ratings = new Map(
    rows.map((row) => [row.novel_id, row.content_rating])
  );
  for (const length of [4, 6, 12, 24]) {
    const r15Count = result
      .slice(0, length)
      .filter((row) => ratings.get(row.novel_id) === 'sensitive_15').length;
    assert.ok(r15Count <= Math.ceil(length / 3));
  }
  assert.deepEqual(
    Array.from(
      result.filter((row) => ratings.get(row.novel_id) === 'sensitive_15'),
      (row) => row.novel_id
    ),
    rows
      .filter((row) => row.content_rating === 'sensitive_15')
      .map((row) => row.novel_id)
  );
  assert.equal(new Set(result.map((row) => row.novel_id)).size, rows.length);
  assert.equal(client.batches.length, 1);
});

test('genre ratio is not forced when only R15 works are available', async () => {
  const mix = await loadMixer();
  const rows = Array.from({ length: 6 }, (_, i) => ({
    novel_id: String(i + 1),
    content_rating: 'sensitive_15'
  }));
  const result = await mix.mixRecommendedRows(rows, makeClient(rows));
  assert.deepEqual(
    Array.from(result, (row) => row.novel_id),
    rows.map((row) => row.novel_id)
  );
});

test('already balanced ordering is preserved and unknown metadata fails open', async () => {
  const mix = await loadMixer();
  const rows = [
    { novel_id: '10', content_rating: 'general' },
    { novel_id: '11', content_rating: 'sensitive_15' },
    { novel_id: '12', content_rating: 'general' },
    { novel_id: '13', content_rating: 'general' },
    { novel_id: '14', content_rating: 'sensitive_15' },
    { novel_id: '15', content_rating: 'general' }
  ];
  const balanced = await mix.mixRecommendedRows(rows, makeClient(rows));
  assert.deepEqual(
    Array.from(balanced, (row) => row.novel_id),
    rows.map((row) => row.novel_id)
  );
  const unknownRows = [{ novel_id: '21' }, { novel_id: '22' }];
  const client = {
    async rpc() {
      return { data: [{ novel_id: '21', content_rating: 'sensitive_15' }] };
    }
  };
  const unknown = await mix.mixRecommendedRows(unknownRows, client);
  assert.deepEqual(
    Array.from(unknown, (row) => row.novel_id),
    ['21', '22']
  );
});

test('recommendation mix retains home viewport receipts and balances the list', async () => {
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const list = await readFile(
    new URL('../novelight-discovery-list.js', import.meta.url),
    'utf8'
  );
  const migration = await readFile(
    new URL(
      '../supabase/migrations/20261012095500_balance_r15_recommendations.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(home, /p_surface:'home_discovery',p_limit:limit/);
  assert.match(migration, /rating_ranked as materialized/);
  assert.match(
    list,
    /NovelightR15\.mixRecommendedRows\(filteredCandidates, client\)/
  );
  assert.match(list, /await recordTrusted\(visible\)/);
});

test('metadata lookups are batched within 50 novel IDs', async () => {
  const mix = await loadMixer();
  const rows = Array.from({ length: 96 }, (_, i) => ({
    novel_id: String(i + 1),
    content_rating: i < 18 ? 'sensitive_15' : 'general'
  }));
  const client = makeClient(rows);
  const result = await mix.mixRecommendedRows(
    rows.map(({ novel_id }) => ({ novel_id })),
    client
  );
  assert.equal(result.length, 96);
  assert.deepEqual(
    client.batches.map((batch) => batch.length),
    [50, 46]
  );
});

test('default R15 hide preference remains OFF', async () => {
  const mix = await loadMixer();
  assert.equal(mix.hiddenPreference(), false);
});
