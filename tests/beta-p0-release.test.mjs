import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test('password recovery is real and login redirect is allowlisted', async () => {
  const [login, forgot, reset] = await Promise.all([
    read('login.html'),
    read('forgot-password.html'),
    read('reset-password.html')
  ]);
  assert.match(login, /href="forgot-password\.html"/);
  assert.doesNotMatch(login, /パスワードを忘れた方<\/a>[^]*href="#"/);
  assert.match(login, /function safeRedirectTarget/);
  assert.match(login, /url\.origin!==window\.location\.origin/);
  assert.match(login, /ALLOWED_PATHS/);
  assert.doesNotMatch(login, /window\.location\.href\s*=\s*redirect\s*;/);
  assert.match(forgot, /resetPasswordForEmail/);
  assert.match(forgot, /reset-password\.html/);
  assert.match(reset, /updateUser\(\{password\}\)/);
  assert.match(reset, /signOut\(\{scope:'local'\}\)/);
});

test('publish path requires AI declaration and content-policy zoning', async () => {
  const files = await Promise.all([
    read('post.html'),
    read('novel-edit.html'),
    read('episode-post.html'),
    read('supabase/migrations/20260823170000_beta_launch_data_foundations.sql'),
    read('supabase/migrations/20260830163000_atomic_episode_publish.sql')
  ]);
  const [post, edit, episodePost, migration, atomicMigration] = files;
  for (const html of [post, edit]) {
    assert.match(html, /aiUsage/);
    assert.match(html, /contentRating/);
    assert.match(html, /content_warnings|warningGrid/);
    assert.match(html, /content_policy_ack|policyAck/);
    assert.match(html, /性的満足を主目的|投稿ガイドライン/);
  }
  assert.match(post, /status:'draft'/);
  assert.match(episodePost, /novelight_publish_episode_atomic/);
  assert.match(atomicMigration, /set status = 'published'/);
  assert.match(migration, /enforce_novel_beta_classification/);
  assert.match(
    migration,
    /ai_usage in \('unspecified', 'human', 'ai_assisted', 'ai_generated'\)/
  );
  assert.match(migration, /content_rating in \('general', 'mature'\)/);
});

test('moderation route is structured and private', async () => {
  const [novel, episode, migration, opsRunbook] = await Promise.all([
    read('novel.html'),
    read('episode.html'),
    read('supabase/migrations/20260823170000_beta_launch_data_foundations.sql'),
    read('docs/BETA-OPERATIONS-RUNBOOK.md')
  ]);
  assert.match(novel, /submit_content_report/);
  assert.match(novel, /p_novel_id:String\(novel\.id\),p_episode_id:null/);
  assert.match(episode, /submit_content_report/);
  assert.match(
    episode,
    /p_novel_id:String\(novel\.id\),p_episode_id:String\(episode\.id\)/
  );
  assert.match(migration, /create table public\.content_reports/);
  assert.match(
    migration,
    /revoke all on table public\.content_reports from public, anon, authenticated/
  );
  assert.match(migration, /copyright/);
  assert.match(migration, /ai_misclassification/);
  assert.match(opsRunbook, /content_reports/);
  assert.match(opsRunbook, /contact_inquiries/);
  assert.match(opsRunbook, /every 6 hours|6時間|6 hours/);
});

test('beta-start attribution, revisit, Founding Authors, and subscription ledgers exist', async () => {
  const [client, migration, webhook] = await Promise.all([
    read('novelight-client.js'),
    read('supabase/migrations/20260823170000_beta_launch_data_foundations.sql'),
    read('api/stripe-webhook.js')
  ]);
  assert.match(client, /utm_source/);
  assert.match(client, /record_acquisition_touch/);
  assert.match(client, /claim_user_acquisition/);
  assert.match(client, /record_beta_visit/);
  assert.match(client, /record_reader_journey_event/);
  assert.match(migration, /create table public\.acquisition_touches/);
  assert.match(migration, /create table public\.beta_activity_days/);
  assert.match(migration, /create table public\.reader_journey_events/);
  assert.match(migration, /create table public\.founding_authors/);
  assert.match(migration, /founding_number between 1 and 100/);
  assert.match(migration, /create table public\.subscription_event_log/);
  assert.match(webhook, /subscription_event_log/);
  assert.match(webhook, /stripe_event_id/);
  assert.match(webhook, /\.upsert\(/);
  assert.match(webhook, /onConflict: 'stripe_event_id'/);
  assert.match(webhook, /ignoreDuplicates: true/);
});

test('discovery v2 gives new works initial priority and measures plan-only exposure', async () => {
  const [migration, home, analytics] = await Promise.all([
    read('supabase/migrations/20260823171000_initial_and_paid_exposure.sql'),
    read('index.html'),
    read('analytics.html')
  ]);
  assert.match(migration, /initial_exposure_target/);
  assert.match(migration, /needs_initial_exposure desc/);
  assert.match(migration, /author_plan = 'premium'/);
  assert.match(migration, /novelight_plan_extra_feed/);
  assert.match(migration, /home_plan_extra/);
  assert.match(migration, /home_premium_slot/);
  assert.match(migration, /premium_slot_impressions/);
  assert.match(home, /novelight_trusted_discovery_feed/);
  assert.match(home, /novelight_trusted_plan_extra_feed/);
  assert.match(home, /record_trusted_allocation_receipts/);
  assert.match(analytics, /novelight_author_exposure_funnel_v2/);
  assert.match(analytics, /plan_extra_impressions/);
  assert.match(analytics, /premium_slot_impressions/);
});

test('LIGHT ANALYTICS uses the required funnel denominators', async () => {
  const analytics = await read('analytics.html');
  assert.match(analytics, /rate\(t\.d,t\.i\)/);
  assert.match(analytics, /rate\(t\.f,t\.d\)/);
  assert.match(analytics, /rate\(t\.s,t\.f\)/);
  assert.match(analytics, /rate\(r\.first_episode_reads_10s,r\.detail_opens\)/);
});

test('all search sorts preserve impression data', async () => {
  const [search, migration] = await Promise.all([
    read('search.html'),
    read('supabase/migrations/20260823171500_neutral_search_impressions.sql')
  ]);
  for (const sort of ['recommended', 'new', 'pv', 'favorites'])
    assert.match(search, new RegExp(`<option value="${sort}">`));
  assert.match(
    search,
    /s==='recommended'\?await recommended\(k,g,current\):await neutral\(k,g,s,current(?:,false)?\)/
  );
  assert.match(search, /record_trusted_allocation_receipts/);
  assert.match(search, /record_neutral_search_impressions/);
  assert.match(migration, /search_results/);
});

test('authoritative impressions require private single-use allocation receipts', async () => {
  const [migration, home, search, gate] = await Promise.all([
    read('supabase/migrations/20260831210000_trusted_allocation_receipts.sql'),
    read('index.html'),
    read('search.html'),
    read('scripts/run-beta-p0-db-tests.sh')
  ]);
  assert.match(migration, /create table public\.novel_allocation_receipts/);
  assert.match(migration, /for update/);
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(
    migration,
    /revoke all on function public\.record_novel_impressions_v2[^;]+from anon, authenticated/
  );
  assert.match(migration, /neutral_search_impression_telemetry/);
  assert.match(home, /novelight_trusted_discovery_feed/);
  assert.match(home, /record_trusted_allocation_receipts/);
  assert.match(search, /record_trusted_allocation_receipts/);
  assert.match(gate, /trusted-allocation-receipts\.sql/);
});

test('major public landing surfaces expose legal navigation', async () => {
  const pages = await Promise.all(
    [
      'index.html',
      'search.html',
      'pricing.html',
      'signup.html',
      'login.html',
      'mypage.html',
      'analytics.html'
    ].map(read)
  );
  for (const html of pages) {
    assert.match(html, /terms\.html/);
    assert.match(html, /privacy\.html/);
  }
  assert.match(pages[0], /content-guidelines\.html/);
  assert.match(pages[0], /commerce-disclosure\.html/);
  assert.match(pages[0], /contact\.html/);
});

test('beta paid-plan disclosures stay aligned before beta release', async () => {
  const [checkout, pricing, billing, commerce, privacy] = await Promise.all([
    read('api/_lib/checkout.js'),
    read('pricing.html'),
    read('billing-policy.html'),
    read('commerce-disclosure.html'),
    read('privacy.html')
  ]);
  assert.match(checkout, /custom_text/);
  assert.match(checkout, /CHECKOUT_LEGAL_NOTICE_BY_PLAN/);
  for (const source of [pricing, billing, commerce]) {
    assert.match(source, /β版特別価格/u);
    assert.match(source, /980円|¥980/u);
    assert.match(source, /1,980円|¥1,980/u);
    assert.match(source, /480円|¥480/u);
    assert.match(source, /クレジットカード登録不要|カード登録不要/u);
  }
  for (const source of [checkout, pricing, billing, commerce])
    assert.match(source, /自動更新/u);
  assert.match(checkout, /月額480円/u);
  assert.match(checkout, /月額1,980円/u);
  assert.doesNotMatch(
    checkout,
    /STRIPE_STANDARD_PRICE_ID.*PRICE_ENV_BY_PLAN/su
  );
  assert.match(pricing, /Standardを無料で利用/u);
  assert.match(
    billing,
    /Standardを利用しているだけで月額料金が請求されることはありません/u
  );
  assert.match(commerce, /Standardのβ無料利用では請求は発生しません/u);
  assert.match(privacy, /個人情報保護法第32条第1項/);
  assert.match(privacy, /本人から求めがあった場合、法令に従い遅滞なく回答/);
});
