// Staging hosted-race safety census. READ-ONLY; never creates fixtures.
// A future OWNER-gated trusted-main runner must check this immediately before
// and after synthetic writes. Any Staging schema drift invalidates approval.
import { readFileSync } from 'node:fs';

const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const EXPECTED_TRIGGERS = Object.freeze({
  episodes: [7, '3dc083fec719753df2e0da09f5dc0a30'],
  novels: [9, '161076c63bc71a6f174f9699fe7aa285'],
  profiles: [3, '99d2b001caf60357f38c90dbd58fc6bc'],
  users: [6, '1a534e511428bd56bd1518ff8daad95a']
});

const EXPECTED_FUNCTIONS = Object.freeze({
  novelight_capture_scout_campaign_entry: 'fcf216ef3062983bea13ff4143b92f53',
  novelight_is_internal_participation_account: 'aa1d87b299d789535f9e06571979b7ba',
  novelight_sync_user_participation_qualifications: '504d6dac6c932d0ed919a1e703ede89c',
  sync_auth_user_participation_after_delete: '8e67c239903d18194cabf631015f7a14'
});

function deny(message) {
  throw new Error('AI_HOSTED_RACE_CENSUS_DENIED: ' + message);
}

// SQL emits only aggregate counts and catalog fingerprints, no user records.
export const PRECHECK_SQL = `
select json_build_object(
  'migrationCount', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '20261028084410'
  ),
  'candidateCount', (
    select count(*) from public.novelight_ai_review_candidates
  ),
  'runtimeSafe', (
    select count(*) = 1 from public.novelight_ai_runtime_settings
    where singleton = 1 and enabled = false
      and user_day_cap_micros = 0 and user_month_cap_micros = 0
      and global_day_cap_micros = 0 and global_month_cap_micros = 0
  ),
  'reservedAuthCount', (
    select count(*) from auth.users
    where id in ('00000000-0000-4000-8000-000000000941'::uuid,
                 '00000000-0000-4000-8000-000000000942'::uuid)
       or lower(email) in ('ai-review-owner@example.invalid',
                          'ai-review-other@example.invalid')
  ),
  'reservedNovelCount', (
    select count(*) from public.novels where id = 998891001
  ),
  'reservedEpisodeCount', (
    select count(*) from public.episodes where id = 998891002
  ),
  'functionFingerprints', (
    select coalesce(json_agg(
      json_build_object(
        'function', p.proname,
        'fingerprint', md5(pg_get_functiondef(p.oid))
      ) order by p.proname
    ), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'novelight_capture_scout_campaign_entry',
        'novelight_is_internal_participation_account',
        'novelight_sync_user_participation_qualifications',
        'sync_auth_user_participation_after_delete'
      )
  ),
  'triggerFingerprints', (
    select coalesce(json_agg(
      json_build_object(
        'table', table_name,
        'count', trigger_count,
        'fingerprint', fingerprint
      ) order by table_name
    ), '[]'::json)
    from (
      select c.relname as table_name, count(*) as trigger_count,
        md5(string_agg(
          t.tgname || ':' || pg_get_triggerdef(t.oid) ||
          E'\\n' || pg_get_functiondef(t.tgfoid),
          E'\\n' order by t.tgname
        )) as fingerprint
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where (
        (n.nspname = 'public'
          and c.relname in ('novels', 'episodes', 'profiles'))
        or (n.nspname = 'auth' and c.relname = 'users')
      ) and not t.tgisinternal
      group by c.relname
    ) fingerprints
  )
) as race_proof_readiness;
`;

export function assertPrecheck(snapshot, projectRef = PROJECT) {
  if (projectRef !== PROJECT) deny('not dedicated Supabase Staging');
  if (!snapshot || typeof snapshot !== 'object' ||
      Array.isArray(snapshot)) deny('missing read-only census');
  if (snapshot.migrationCount !== 1 ||
      snapshot.candidateCount !== 0 ||
      snapshot.runtimeSafe !== true ||
      snapshot.reservedAuthCount !== 0 ||
      snapshot.reservedNovelCount !== 0 ||
      snapshot.reservedEpisodeCount !== 0) {
    deny('migration, kill switch, budgets, or reserved IDs unsafe');
  }
  if (!Array.isArray(snapshot.triggerFingerprints) ||
      snapshot.triggerFingerprints.length !== 4) {
    deny('trigger coverage drift');
  }
  const seen = new Set();
  for (const row of snapshot.triggerFingerprints) {
    const name = row?.table;
    const expected = EXPECTED_TRIGGERS[name];
    if (!expected || seen.has(name) ||
        row.count !== expected[0] || row.fingerprint !== expected[1]) {
      deny('unreviewed signup, novel, episode or profile trigger');
    }
    seen.add(name);
  }
  if (!Array.isArray(snapshot.functionFingerprints) ||
      snapshot.functionFingerprints.length !== 4) {
    deny('internal-test and campaign function coverage drift');
  }
  const functionNames = new Set();
  for (const row of snapshot.functionFingerprints) {
    const name = row?.function;
    if (!Object.hasOwn(EXPECTED_FUNCTIONS, name) ||
        functionNames.has(name) ||
        row.fingerprint !== EXPECTED_FUNCTIONS[name]) {
      deny('internal account, campaign or cleanup function changed');
    }
    functionNames.add(name);
  }
  return true;
}

if (process.argv[2] === 'sql') {
  process.stdout.write(PRECHECK_SQL);
} else if (process.argv[2] === 'assert') {
  try {
    if (process.argv.length !== 4) deny('expected one JSON snapshot path');
    const snapshot = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    assertPrecheck(snapshot, process.env.STAGING_PROJECT_REF);
    process.stdout.write('AI_STAGING_CENSUS_PASS (read-only)\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
