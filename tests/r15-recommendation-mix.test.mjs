import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

async function mixer() {
  const code = await read('../novelight-r15-discovery.js');
  const context = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    localStorage: {
      getItem() {
        return null;
      }
    },
    console,
    URL
  };
  runInNewContext(code, context);
  return context.window.NovelightR15;
}

test('R15 recommendation interleave keeps a balanced visible prefix', async () => {
  const mix = await mixer();
  const rows = Array.from({ length: 18 }, (_, i) => ({
    novel_id: String(i + 1)
  }));
  const client = {
    async rpc(name, args) {
      assert.equal(name, 'novelight_search_card_metadata');
      return {
        data: args.p_novel_ids.map((id) => ({
          novel_id: id,
          content_rating: Number(id) <= 6 ? 'sensitive_15' : 'general'
        }))
      };
    }
  };
  const result = await mix.mixRecommendedRows(rows, client);
  const firstSix = result.slice(0, 6);
  const ids = firstSix.map((row) => Number(row.novel_id));
  assert.equal(ids.filter((id) => id <= 6).length, 2);
  assert.equal(new Set(result.map((row) => row.novel_id)).size, 18);
  assert.equal(mix.hiddenPreference(), false);
});

test('home keeps viewport-size receipts while recommendation list mixes', async () => {
  const home = await read('../index.html');
  const list = await read('../novelight-discovery-list.js');
  const sql = await read(
    '../supabase/migrations/20261012095500_balance_r15_recommendations.sql'
  );
  assert.match(home, /p_surface:'home_discovery',p_limit:limit/);
  assert.match(list, /mixRecommendedRows\(filteredCandidates, client\)/);
  assert.match(sql, /rating_ranked as materialized/);
  assert.match(sql, /r\.rating_rank \* 3 - 2/);
});
