import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260924091509_harden_bulk_import_and_analytics_abuse.sql'
);
const precheck = read(
  'supabase/checks/20260924091509_harden_bulk_import_and_analytics_abuse_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260924091509_harden_bulk_import_and_analytics_abuse_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260924091509_harden_bulk_import_and_analytics_abuse_rollback.sql'
);
const replay = read('scripts/run-migration-replay.sh');
const rlsRegression = read('tests/rls/audit-004-005-abuse-controls.sql');
const analyticsApi = read('api/analytics-event.js');
const client = read('novelight-client.js');
const episodePage = read('episode.html');
const searchPage = read('search.html');
const exposureMigration = read(
  'supabase/migrations/20260823133000_exposure_funnel_retention.sql'
);

test('AUDIT-004 keeps the 100-episode UX and enforces database payload bounds', () => {
  assert.match(migration, /between 1 and 100 episodes/u);
  assert.match(migration, /between 1 and 200 episodes/u);
  assert.match(migration, /5000000 characters/u);
  assert.match(migration, /20000000 bytes/u);
  assert.match(migration, /v_draft_count \+ p_episode_count > 2000/u);
  assert.match(migration, /'draft'/u);
});

test('AUDIT-004 quotas are per-user, race-safe, replay-resistant, and auditable', () => {
  assert.match(migration, /create table public\.bulk_import_requests/u);
  assert.match(migration, /extensions\.digest/u);
  assert.match(migration, /interval '24 hours'/u);
  assert.match(migration, /interval '10 minutes'/u);
  assert.match(migration, /v_recent_count >= 5/u);
  assert.match(migration, /v_daily_count >= 20/u);
  assert.match(migration, /v_daily_episode_count \+ p_episode_count > 1000/u);
  assert.match(
    migration,
    /v_daily_body_chars \+ p_body_char_count > 20000000/u
  );
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /for update/u);
  assert.match(migration, /n\.user_id = p_user_id|v_owner_id <> p_user_id/u);
});

test('AUDIT-004 daily quota regression is deterministic across the JST boundary', () => {
  const explicitJstDayStarts = migration.match(
    /pg_catalog\.timezone\(\s*'Asia\/Tokyo',\s*\(pg_catalog\.timezone\('Asia\/Tokyo', v_now\)::date\)::timestamp without time zone\s*\)/gu
  );

  assert.equal(explicitJstDayStarts?.length, 6);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.timezone\(\s*'Asia\/Tokyo',\s*pg_catalog\.timezone\('Asia\/Tokyo', v_now\)::date\s*\)/u
  );
  assert.match(
    rlsRegression,
    /create function pg_temp\.novelight_jst_day_start/u
  );
  assert.match(
    rlsRegression,
    /\(pg_catalog\.timezone\('Asia\/Tokyo', p_instant\)::date\)::timestamp without time zone/u
  );
  assert.match(rlsRegression, /JST 23:59:59 resolved to the wrong quota day/u);
  assert.match(rlsRegression, /JST 00:00:00 did not start a new quota day/u);
  assert.match(rlsRegression, /JST 00:00:01 resolved to the wrong quota day/u);
  assert.match(
    rlsRegression,
    /Normal JST daytime resolved to the wrong quota day/u
  );
  assert.match(
    rlsRegression,
    /novelight_jst_day_start\(pg_catalog\.now\(\)\) \+ interval '1 minute'/u
  );
  assert.doesNotMatch(rlsRegression, /now\(\) - interval '20 minutes'/u);
  assert.match(
    rlsRegression,
    /validate constraint bulk_import_requests_episode_count_check/u
  );
  assert.match(
    rlsRegression,
    /current_setting\(\s*'novelight\.test\.audit_episode_id'/u
  );
  assert.doesNotMatch(
    rlsRegression,
    /set local role service_role;[\s\S]*?select e\.id::text into v_episode_id/u
  );
});

test('AUDIT-005 dedupes and caps all weak analytics endpoints', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_record_bulk_import_event/u
  );
  assert.match(migration, /interval '5 minutes'/u);
  assert.match(migration, />= 30/u);
  assert.match(migration, />= 200/u);

  assert.match(
    migration,
    /create or replace function public\.novelight_record_scout_record_visit/u
  );
  assert.match(migration, /v_visit_count >= 48/u);
  assert.match(migration, /interval '10 minutes'/u);

  assert.match(
    migration,
    /create or replace function public\.record_beta_visit/u
  );
  assert.match(
    migration,
    /create or replace function public\.record_acquisition_touch/u
  );
  assert.match(migration, /interval '30 minutes'/u);
  assert.match(migration, /Daily acquisition event limit exceeded/u);

  assert.match(migration, /public\.record_reader_journey_event/u);
  assert.match(migration, /Reader journey hourly limit exceeded/u);
  assert.match(migration, /Reader journey daily limit exceeded/u);
  assert.match(migration, /public\.record_episode_pv/u);
  assert.match(migration, /Episode PV hourly limit exceeded/u);
  assert.match(migration, /Episode PV daily limit exceeded/u);
  assert.match(migration, /public\.record_neutral_search_impressions/u);
  assert.match(migration, /Neutral search hourly limit exceeded/u);
  assert.match(migration, /Neutral search daily limit exceeded/u);
});

test('anonymous analytics uses the server fingerprint boundary', () => {
  assert.match(
    analyticsApi,
    /process\.env\.NOVELIGHT_ANALYTICS_FINGERPRINT_SECRET/u
  );
  assert.match(analyticsApi, /createHmac\('sha256', fingerprintSecret\)/u);
  assert.match(analyticsApi, /Buffer\.byteLength\(fingerprintSecret/u);
  assert.match(analyticsApi, /fingerprintSecret === supabaseSecret/u);
  assert.doesNotMatch(
    analyticsApi,
    /requestFingerprint\(req, supabaseSecret\)/u
  );
  assert.match(analyticsApi, /x-vercel-forwarded-for/u);
  assert.match(analyticsApi, /isSameOriginRequest/u);
  assert.match(analyticsApi, /serviceClient\.rpc/u);
  assert.doesNotMatch(analyticsApi, /body\.visitor_token/u);
  assert.match(client, /fetch\('\/api\/analytics-event'/u);
  assert.doesNotMatch(client, /client\.rpc\('record_acquisition_touch'/u);
  assert.doesNotMatch(client, /client\.rpc\('record_beta_visit'/u);
  assert.doesNotMatch(client, /client\.rpc\('record_reader_journey_event'/u);
  assert.doesNotMatch(episodePage, /client\.rpc\('record_episode_pv'/u);
  assert.doesNotMatch(
    searchPage,
    /client\.rpc\('record_neutral_search_impressions'/u
  );
  for (const action of [
    'journey',
    'episode-pv',
    'neutral-search-impressions'
  ]) {
    assert.match(
      analyticsApi,
      new RegExp(`body\\.action === '${action}'`, 'u')
    );
  }
  assert.match(
    migration,
    /record_beta_visit\(text,text,text\)[\s\S]*from public, anon;[\s\S]*to authenticated, service_role/u
  );
  assert.match(
    migration,
    /record_acquisition_touch\(text,text,text,text,text,text,text\)[\s\S]*from public, anon, authenticated;[\s\S]*to service_role/u
  );
  for (const signature of [
    'record_reader_journey_event\\(text,text,text,text,text\\)',
    'record_episode_pv\\(text,text\\)',
    'record_neutral_search_impressions\\(text\\[\\],text\\)'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `${signature}[\\s\\S]*from public, anon;[\\s\\S]*to authenticated, service_role`,
        'u'
      )
    );
  }
});

test('exposure conversion remains tied to real recent exposure and validated targets', () => {
  assert.match(
    exposureMigration,
    /e\.exposed_at >= now\(\) - interval '24 hours'/u
  );
  assert.match(exposureMigration, /e\.viewer_key = v_viewer_key/u);
  assert.match(exposureMigration, /n\.status = 'published'/u);
  assert.match(exposureMigration, /e\.status = 'published'/u);
  assert.match(exposureMigration, /from public\.favorites f/u);
  assert.match(exposureMigration, /on conflict do nothing/u);
});

test('identity and target authorization stay server-derived', () => {
  assert.match(migration, /v_user_id uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /v_uid uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /n\.user_id = v_user_id/u);
  assert.match(migration, /md5\('user:' \|\| v_uid::text\)/u);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.novelight_record_bulk_import_event[\s\S]*p_user_id/u
  );
});

test('new audit data is RLS-protected and raw client access is revoked', () => {
  assert.match(
    migration,
    /alter table public\.bulk_import_requests enable row level security/u
  );
  assert.match(
    migration,
    /revoke all on table public\.bulk_import_requests from public, anon, authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function private\.novelight_reserve_bulk_import[\s\S]*service_role/u
  );
  assert.match(
    postcheck,
    /Client roles must not access raw bulk import request/u
  );
});

test('migration safety set contains precheck, postcheck, rollback, and replay coverage', () => {
  assert.match(precheck, /AUDIT-004\/005 prerequisite tables are missing/u);
  assert.match(precheck, /pgcrypto digest/u);
  assert.match(
    postcheck,
    /Bulk import quota, replay, or concurrency controls/u
  );
  assert.match(
    rollback,
    /bulk_import_requests contains audit data; preserve it before rollback/u
  );
  assert.match(rollback, /security invoker/u);
  assert.match(
    replay,
    /20260924091509_harden_bulk_import_and_analytics_abuse_postcheck\.sql/u
  );
  assert.match(replay, /tests\/rls\/audit-004-005-abuse-controls\.sql/u);
});
