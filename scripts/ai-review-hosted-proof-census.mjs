// Staging hosted-race safety census. READ-ONLY; never creates fixtures.
// A future OWNER-gated trusted-main runner must check this immediately before
// and after synthetic writes. Any Staging schema drift invalidates approval.
import { readFileSync } from 'node:fs';

const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const EXPECTED_TRIGGERS = Object.freeze({
  episodes: [7, '32dc9047f332d6a1a7bddae7f7538a6d'],
  novels: [9, 'df0282d8ad64a429118e5057e57d20a2'],
  profiles: [3, 'dc74a4cb78131f7375191c4edb2799f0'],
  users: [6, '573355b7a9d1bcf2ae224721af2ffa1b']
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
          t.tgname || ':' || pg_get_triggerdef(t.oid),
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
