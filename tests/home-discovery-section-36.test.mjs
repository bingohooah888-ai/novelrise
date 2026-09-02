import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test('homepage exposes one natural recommendation shelf and the beta new-arrivals path', async () => {
  const home = await read('index.html');

  assert.match(home, /<h2>あなたへのおすすめ<\/h2>/u);
  assert.match(home, /href="search\.html\?sort=new"/);
  assert.match(home, />もっと見る<\/a>/u);
  assert.doesNotMatch(home, /id="planExtraWrap"|id="planExtraGrid"/);
  assert.doesNotMatch(home, /id="premiumWrap"|id="premiumGrid"/);
  assert.doesNotMatch(home, /LIGHT SEEDで発掘中/u);
});

test('homepage allocation and authoritative recording use the same viewport-sized visible set', async () => {
  const home = await read('index.html');

  assert.match(
    home,
    /function discoveryVisibleLimit\(\)\{return window\.matchMedia\('\(max-width:860px\)'\)\.matches\?4:6\}/
  );
  assert.match(home, /p_surface:'home_discovery',p_limit:limit/);
  assert.match(
    home,
    /visible=selectVisibleDiscoveryRows\(general,planRows,premium,limit\)/
  );
  assert.match(home, /grid\.innerHTML=visible\.length\?visible\.map\(card\)/);
  assert.match(home, /if\(visible\.length\)void record\(visible\)/);
  assert.doesNotMatch(home, /record\(general\)|record\(planRows\)|record\(premium\)/);
});

test('trusted allocation stays authoritative while plan-specific sources remain internally measurable', async () => {
  const [home, trustedMigration] = await Promise.all([
    read('index.html'),
    read('supabase/migrations/20260831210000_trusted_allocation_receipts.sql')
  ]);

  assert.match(home, /novelight_trusted_discovery_feed/);
  assert.match(home, /novelight_trusted_plan_extra_feed/);
  assert.match(home, /record_trusted_allocation_receipts/);
  assert.match(home, /rows\.filter\(x=>!x\.is_premium_slot\)/);
  assert.match(home, /rows\.filter\(x=>x\.is_premium_slot\)/);
  assert.match(home, /planExtraFeed\(\{p_limit:1,p_exclude_novel_ids:excluded/);

  assert.match(trustedMigration, /plan_snapshot text not null/);
  assert.match(trustedMigration, /'home_plan_extra'/);
  assert.match(trustedMigration, /'home_premium_slot'/);
  assert.match(trustedMigration, /allocation_reason/);
  assert.match(trustedMigration, /record_trusted_allocation_receipts/);
  assert.match(
    trustedMigration,
    /revoke all on function public\.record_novel_impressions_v2[^;]+from anon, authenticated/
  );
});

test('controlled rotation and fairness do not make paid status an unconditional first-position rule', async () => {
  const [home, allocation] = await Promise.all([
    read('index.html'),
    read('supabase/migrations/20260823171000_initial_and_paid_exposure.sql')
  ]);

  assert.match(
    home,
    /const key=visitor\(\)\+':'\+Math\.floor\(Date\.now\(\)\/3600000\)/
  );
  assert.match(
    home,
    /if\(gi<general\.length\)ordered\.push\(general\[gi\+\+\]\);if\(gi<general\.length\)ordered\.push\(general\[gi\+\+\]\);if\(ei<extras\.length\)ordered\.push\(extras\[ei\+\+\]\)/
  );
  assert.match(allocation, /recently_seen asc/);
  assert.match(allocation, /needs_initial_exposure desc/);
  assert.match(allocation, /date_trunc\('hour', now\(\)\)/);

  const initialPriority = allocation.indexOf('r.needs_initial_exposure desc');
  const weightedAuthorExposure = allocation.indexOf('r.normalized_author_exposure asc');
  assert.ok(initialPriority >= 0);
  assert.ok(weightedAuthorExposure > initialPriority);
});

test('homepage selection protects author diversity before filling remaining slots', async () => {
  const home = await read('index.html');

  assert.match(home, /const authors=new Set\(\),primary=\[\],deferred=\[\]/);
  assert.match(home, /if\(author&&authors\.has\(author\)\)deferred\.push\(row\)/);
  assert.match(home, /primary\.concat\(deferred\)\.slice\(0,limit\)/);
});

test('new-arrivals homepage link selects neutral new ordering on search', async () => {
  const search = await read('search.html');

  assert.match(search, /allowedSorts=new Set\(\['recommended','new','pv','favorites'\]\)/);
  assert.match(
    search,
    /new URLSearchParams\(window\.location\.search\)\.get\('sort'\)/
  );
  assert.match(
    search,
    /if\(allowedSorts\.has\(requestedSort\)\)document\.getElementById\('sortSelect'\)\.value=requestedSort/
  );
  assert.match(search, /p_sort:sort/);
});
