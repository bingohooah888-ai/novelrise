// Dedicated Staging census reader. No connection or I/O on import.
// No DDL/grants: the operator must separately verify a SELECT-only role.
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const ROLE = 'novelight_gatea_census';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
function deny() { throw new Error('AI_020705_INDEPENDENT_CENSUS_NO_GO'); }

export function validate020705CensusUrl(value) {
  try {
    const u = new URL(value);
    const direct = u.hostname === 'db.' + PROJECT + '.supabase.co' &&
      u.username === ROLE;
    const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(u.hostname) &&
      u.username === ROLE + '.' + PROJECT;
    if (!['postgres:', 'postgresql:'].includes(u.protocol) ||
        !(direct || pooled) || u.port !== '5432' || u.pathname !== '/postgres' ||
        !u.password || u.search || u.hash) deny();
    return true;
  } catch { deny(); }
}

const ROLE_SQL = `
select current_user = 'novelight_gatea_census'
  and session_user = current_user
  and rolcanlogin and not rolinherit
  and not (rolsuper or rolcreatedb or rolcreaterole or rolreplication)
  and not exists (select 1 from pg_auth_members where member = r.oid)
  and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (c.relowner = r.oid
        or has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
        or has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES'))
  ) as ok
from pg_roles r where rolname = current_user
`;

// row_security=off makes filtered RLS reads fail instead of returning false
// zeros. A separately reviewed role must actually have complete scoped visibility.
const CENSUS_SQL = `
select
 (select count(*)::int from auth.users where id=$1::uuid) as "users",
 (select count(*)::int from auth.identities where user_id=$1::uuid) as "identities",
 (select count(*)::int from auth.sessions where user_id=$1::uuid) as "sessions",
 (select count(*)::int from public.profiles where id=$1::uuid) as "profiles",
 (select count(*)::int from public.novels where user_id=$1::uuid or id=$2::bigint) as "novels",
 (select count(*)::int from public.episodes where user_id=$1::uuid or novel_id=$2::bigint or id=$4::bigint) as "episodes",
 (select count(*)::int from public.novelight_ai_bible_facts where novel_id=$2::bigint or source_episode_id=$4::bigint) as "facts",
 (select count(*)::int from public.novelight_ai_episode_analysis a where episode_id=$4::bigint or exists
   (select 1 from public.episodes e where e.id=a.episode_id and (e.novel_id=$2::bigint or e.user_id=$1::uuid))) as "analysis",
 (select count(*)::int from public.novelight_ai_review_candidates where actor_id=$1::uuid or novel_id=$2::bigint or source_episode_id=$4::bigint) as "reviewCandidates",
 (select count(*)::int from public.novelight_ai_external_processing_consents where actor_id=$1::uuid or novel_id=$2::bigint) as "consents",
 (select count(*)::int from public.novelight_ai_external_consent_action_audit where actor_id=$1::uuid or novel_id=$2::bigint) as "consentAudit",
 (select count(*)::int from public.novelight_ai_usage_requests where actor_id=$1::uuid or work_id=$2::bigint) as "usageRequests",
 (select count(*)::int from public.novelight_ai_usage_audit where actor_id=$1::uuid or work_id=$2::bigint) as "usageAudit",
 (select count(*)=1 from public.novelight_ai_runtime_settings where singleton=1 and enabled=false
   and user_day_cap_micros=0 and user_month_cap_micros=0 and global_day_cap_micros=0 and global_month_cap_micros=0) as "runtimeDisabledZero",
 (select count(*)::int from public.novelight_ai_020705_one_shot_claims where approval_comment_id=$3::bigint
   and actor_id=$1::uuid and novel_id=$2::bigint and episode_id=$4::bigint
   and main_sha=$5 and preview_deployment_id=$6) as "approvalTombstoneCount",
 (select count(*)::int from public.novelight_ai_chunk_claims where actor_id=$1::uuid or novel_id=$2::bigint) as "chunkClaimsRetained"
`;

export function create020705IndependentCensusReader({ connectionString, scope } = {}) {
  validate020705CensusUrl(connectionString);
  if (scope?.stagingProjectRef !== PROJECT || !UUID.test(scope.actorId ?? '') ||
      ![scope.novelId, scope.episodeId, scope.approvalCommentId].every(positive) ||
      !/^[a-f0-9]{40}$/u.test(scope.mainSha ?? '') ||
      !/^dpl_[A-Za-z0-9]+$/u.test(scope.previewDeploymentId ?? '')) deny();
  const pinned = Object.freeze({ ...scope });
  return async function independentCensus(target) {
    if (target?.projectRef !== PROJECT || target.userId !== pinned.actorId ||
        target.novelId !== pinned.novelId ||
        target.approvalCommentId !== pinned.approvalCommentId) deny();
    let client;
    try {
      const { Client } = await import('pg');
      client = new Client({ connectionString, ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 5000, query_timeout: 10000 });
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query('SET LOCAL row_security = off');
      const role = await client.query(ROLE_SQL);
      if (role.rows?.length !== 1 || role.rows[0].ok !== true) deny();
      const result = await client.query(CENSUS_SQL, [pinned.actorId, pinned.novelId,
        pinned.approvalCommentId, pinned.episodeId, pinned.mainSha, pinned.previewDeploymentId]);
      if (result.rows?.length !== 1) deny();
      await client.query('ROLLBACK');
      return Object.freeze({ ...result.rows[0], projectRef: PROJECT,
        userId: pinned.actorId, novelId: pinned.novelId,
        approvalCommentId: pinned.approvalCommentId,
        sourceKind: 'SEPARATE_STAGING_READONLY_CENSUS' });
    } catch { deny(); }
    finally {
      if (client) {
        try { await client.end(); } catch { deny(); }
      }
    }
  };
}
