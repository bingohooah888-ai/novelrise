import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test('homepage exposes recommendations, real new arrivals, and a data-backed conditional LIGHT SEED shelf', async () => {
  const home = await read('index.html');

  assert.match(home, /<h2>あなたへのおすすめ<\/h2>/u);
  assert.match(home, /id="newGrid"/u);
  assert.match(home, /href="recommended\.html"/);
  assert.match(home, /href="new-arrivals\.html"/);
  assert.match(home, /href="light-seed\.html"/);
  assert.match(home, /id="seedShelfSection"[^>]*hidden/u);
  assert.match(home, /<h2>LIGHT SEEDで発掘中<\/h2>/u);
  assert.match(home, /novelight_neutral_search/u);
  assert.match(home, /light_seed_status/u);
  assert.match(home, /total_seed_count/u);
  assert.match(home, /section\.hidden=!seeded\.length/u);
  assert.doesNotMatch(home, /id="planExtraWrap"|id="planExtraGrid"/);
  assert.doesNotMatch(home, /id="premiumWrap"|id="premiumGrid"/);
});

test('homepage dark redesign keeps an approved-art replacement slot and avoids fake scale metrics', async () => {
  const home = await read('index.html');
  const css = await read('novelight-public-dark.css');

  assert.match(home, /class="hero-art-slot"/u);
  assert.match(home, /まだ見ぬ物語に、/u);
  assert.match(home, /まだ見ぬ物語に、<br><span>光を<\/span>/u);
  assert.match(home, /class="recommend-ribbon">おすすめ<\/div>/u);
  assert.match(css, /--public-gold:/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(home, /25万|210万|15万|4\.9/u);
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
  assert.doesNotMatch(
    home,
    /record\(general\)|record\(planRows\)|record\(premium\)/
  );
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
  const weightedAuthorExposure = allocation.indexOf(
    'r.normalized_author_exposure asc'
  );
  assert.ok(initialPriority >= 0);
  assert.ok(weightedAuthorExposure > initialPriority);
});

test('homepage selection protects author diversity before filling remaining slots', async () => {
  const home = await read('index.html');

  assert.match(home, /const authors=new Set\(\),primary=\[\],deferred=\[\]/);
  assert.match(
    home,
    /if\(author&&authors\.has\(author\)\)deferred\.push\(row\)/
  );
  assert.match(home, /primary\.concat\(deferred\)\.slice\(0,limit\)/);
});

test('dedicated discovery pages use 24-work batches without changing feed policy', async () => {
  const [recommended, newArrivals, seed, script] = await Promise.all([
    read('recommended.html'),
    read('new-arrivals.html'),
    read('light-seed.html'),
    read('novelight-discovery-list.js')
  ]);

  assert.match(recommended, /data-discovery-mode="recommended"/);
  assert.match(newArrivals, /data-discovery-mode="new"/);
  assert.match(seed, /data-discovery-mode="seed"/);
  assert.match(recommended, /id="discoveryMore"/);
  assert.match(newArrivals, /id="discoveryMore"/);
  assert.match(seed, /id="discoveryMore"/);
  assert.match(script, /const pageSize = 24;/);
  assert.match(script, /p_surface: 'search_recommended'/);
  assert.match(script, /record_trusted_allocation_receipts/);
  assert.match(script, /p_sort: 'new'/);
  assert.match(script, /p_offset: neutralOffset/);
  assert.match(script, /light_seed_status/);
  assert.match(script, /result\.data\?\.eligible !== true/);
  assert.match(script, /seedQueue\.splice\(0, pageSize\)/);
});

test('search still accepts supported sort query parameters independently of home discovery links', async () => {
  const search = await read('search.html');

  assert.match(
    search,
    /allowedSorts=new Set\(\['recommended','new','pv','favorites'\]\)/
  );
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
