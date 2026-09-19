import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const repoRoot = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

function rootHtmlFiles() {
  return readdirSync(repoRoot)
    .filter((name) => name.endsWith('.html'))
    .sort();
}

test('browser Supabase runtime is pinned to the lockfile version', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const version =
    lock.packages?.['node_modules/@supabase/supabase-js']?.version;
  assert.ok(version, 'Supabase JS lockfile version must be available');
  const expected = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${version}`;
  const offenders = rootHtmlFiles().filter((name) => {
    const html = read(name);
    return html.includes('@supabase/supabase-js@') && !html.includes(expected);
  });
  assert.deepEqual(
    offenders,
    [],
    `Supabase browser runtime must match package-lock: ${offenders.join(', ')}`
  );
});

test('novel deletion relies on the database cascade and never pre-deletes episodes', () => {
  const html = read('novel.html');
  const deleteFunction = html.match(
    /async function deleteNovel\(\)\{[\s\S]*?\}\}\nasync function recordOpen/
  );
  assert.ok(deleteFunction, 'deleteNovel function must be present');
  assert.match(deleteFunction[0], /from\('novels'\)\.delete\(\)/);
  assert.doesNotMatch(deleteFunction[0], /from\('episodes'\)\.delete\(\)/);
});

test('public author and favorite reads use narrow aggregate RPCs', () => {
  const author = read('author.html');
  const novel = read('novel.html');

  assert.match(author, /rpc\('novelight_public_profile'/);
  assert.doesNotMatch(
    author,
    /from\('profiles'\)\.select\('display_name,bio'\)/
  );
  assert.match(novel, /rpc\('novelight_public_profile'/);
  assert.match(novel, /rpc\('novelight_favorite_count'/);
});

test('no browser page performs a global raw favorite count', () => {
  const forbidden =
    /from\('favorites'\)\.select\('\*',\s*\{count:'exact',head:true\}\)/;
  const offenders = rootHtmlFiles().filter((name) =>
    forbidden.test(read(name))
  );
  assert.deepEqual(
    offenders,
    [],
    `global raw favorite counts must stay behind aggregate RPCs: ${offenders.join(', ')}`
  );
});

test('neutral search, ranking and author basic analytics aggregate in database RPCs', () => {
  const search = read('search.html');
  const ranking = read('ranking.html');
  const analytics = read('novelight-analytics.js');
  const metricsMigration = read(
    'supabase/migrations/20260828224000_author_basic_metrics.sql'
  );

  assert.match(search, /rpc\('novelight_neutral_search'/);
  assert.match(search, /p_offset:/);
  assert.doesNotMatch(search, /Promise\.all\(rows\.map\(async n=>/);
  assert.doesNotMatch(search, /from\('favorites'\).*count:'exact'/);

  assert.match(ranking, /rpc\('novelight_ranking_feed_v2'/);
  assert.doesNotMatch(ranking, /from\('favorites'\).*count:'exact'/);
  assert.doesNotMatch(ranking, /from\('novels'\)\.select/);

  assert.match(analytics, /rpc\('novelight_author_basic_metrics'/);
  assert.doesNotMatch(analytics, /for\s*\(const novel of rows\)/);
  assert.match(metricsMigration, /security definer/i);
  assert.match(metricsMigration, /grant execute .* to authenticated/i);
});

test('profile and favorite raw reads are own-only in the hardening migration', () => {
  const migration = read(
    'supabase/migrations/20260828223000_harden_profile_favorite_reads_and_discovery.sql'
  );

  assert.match(
    migration,
    /revoke select on table public\.profiles from anon, authenticated/i
  );
  assert.match(
    migration,
    /revoke select on table public\.favorites from anon, authenticated/i
  );
  assert.match(migration, /create policy novelight_profiles_select_own/i);
  assert.match(migration, /create policy novelight_favorites_select_own/i);
  assert.match(migration, /novelight_public_profile[\s\S]*?security definer/i);
});

test('only self-service pages read raw profiles directly', () => {
  const allowed = new Set(['analytics.html', 'mypage.html']);
  const directProfileRead = /from\('profiles'\)\.select\(/;
  const offenders = rootHtmlFiles().filter(
    (name) => !allowed.has(name) && directProfileRead.test(read(name))
  );
  assert.deepEqual(
    offenders,
    [],
    `public pages must use narrow profile RPCs: ${offenders.join(', ')}`
  );
});

test('episode PV counting is server-authoritative and legacy raw RPCs are blocked', () => {
  const episode = read('episode.html');
  const migration = read(
    'supabase/migrations/20260901130000_harden_pv_counting.sql'
  );

  assert.match(episode, /rpc\('record_episode_pv'/);
  assert.doesNotMatch(episode, /rpc\('increment_novel_pv'/);
  assert.doesNotMatch(episode, /rpc\('increment_episode_pv'/);
  assert.doesNotMatch(episode, /novelight_pv_episode_/);
  assert.match(migration, /create table public\.episode_pv_events/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /interval '6 hours'/i);
  assert.match(
    migration,
    /revoke all on function public\.increment_novel_pv\(bigint\) from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /revoke all on function public\.increment_episode_pv\(bigint\) from public, anon, authenticated/i
  );
});

test('authenticated smoke includes a mobile Pixel 7 product flow without duplicating billing smoke', () => {
  const config = read('tests/e2e/playwright.production-auth.config.mjs');
  const smoke = read('tests/e2e/production-auth/authenticated-smoke.spec.js');

  assert.match(config, /production-authenticated-mobile-chromium/);
  assert.match(config, /devices\['Pixel 7'\]/);
  assert.ok(
    config.includes('testMatch: /authenticated-smoke\\.spec\\.js/'),
    'mobile project must target only the product smoke'
  );
  assert.match(smoke, /contextOptionsForProject/);
  assert.match(smoke, /devices\['Pixel 7'\]/);
  assert.match(smoke, /Delete work with one atomic parent request/);
});

test('staging public smoke also exercises Pixel 7', () => {
  const config = read('tests/e2e/playwright.staging.config.mjs');
  const smoke = read('tests/e2e/staging/read-only-smoke.spec.js');

  assert.match(config, /staging-mobile-chromium/);
  assert.match(config, /devices\['Pixel 7'\]/);
  assert.match(smoke, /browser security headers are active/);
  assert.match(smoke, /novelight|ranking/i);
});

test('Vercel applies baseline browser security headers', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = config.headers?.[0]?.headers || [];
  const map = new Map(headers.map(({ key, value }) => [key, value]));

  assert.match(
    map.get('Content-Security-Policy') || '',
    /frame-ancestors 'none'/
  );
  assert.match(map.get('Content-Security-Policy') || '', /object-src 'none'/);
  assert.equal(map.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(map.get('X-Frame-Options'), 'DENY');
  assert.equal(map.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.match(map.get('Permissions-Policy') || '', /camera=\(\)/);
});

test('beta search does not expose spoofable raw-PV ordering', () => {
  const search = read('search.html');
  assert.doesNotMatch(search, /<option value="pv">/);
  assert.doesNotMatch(search, /allowedSorts=new Set\(\[[^\]]*['"]pv['"]/);
  assert.doesNotMatch(search, /新着・PV・お気に入り順/);
});

test('author UI and database both block self-favorites', () => {
  const novel = read('novel.html');
  const migration = read(
    'supabase/migrations/20260919195300_beta_final_fairness_hardening.sql'
  );
  assert.match(
    novel,
    /const owner=Boolean\(session&&novel\.user_id===session\.user\.id\)/
  );
  assert.match(novel, /if\(owner\)\{b\.hidden=true/);
  assert.match(migration, /novelight_can_favorite_novel/);
  assert.match(
    migration,
    /and public\.novelight_can_favorite_novel\(novel_id\)/
  );
});

test('final fairness migration requires server-clock reading evidence', () => {
  const migration = read(
    'supabase/migrations/20260919195300_beta_final_fairness_hardening.sql'
  );
  assert.match(
    migration,
    /v_foreground_signal and \(v_progress_signal or v_interaction_signal\)/
  );
  assert.match(migration, /count\(distinct vr\.reader_id\)::bigint/);
  assert.match(migration, /timestamptz '2026-09-30 00:00:00\+09'/);
});

test('beta terms are presented as an active beta document, not a draft', () => {
  const terms = read('terms.html');
  assert.doesNotMatch(terms, /β版ドラフト/);
  assert.match(terms, /最終改定日：2026年9月19日 \/ β版/);
  assert.match(terms, /作者本人は自作品をお気に入り登録できません/);
});
