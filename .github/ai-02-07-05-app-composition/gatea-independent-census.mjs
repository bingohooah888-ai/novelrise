// Fixed Staging Management API read-only transport. No DB login or writes.
// Token scope must be independently verified at issuance; the prefix alone
// is not evidence of project or permission scope. No I/O on import.
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const ENDPOINT =
  'https://api.supabase.com/v1/projects/' + PROJECT + '/database/query/read-only';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const COUNTS = [
  'users', 'identities', 'sessions', 'profiles', 'novels', 'episodes',
  'facts', 'analysis', 'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit', 'approvalTombstoneCount', 'chunkClaimsRetained'
];
function deny() { throw new Error('AI_020705_INDEPENDENT_CENSUS_NO_GO'); }

export function validate020705CensusToken(value) {
  if (typeof value !== 'string' || !/^sbp_fc[A-Za-z0-9_-]{16,512}$/u.test(value)) deny();
  return true;
}

// Evaluate authority and census in the SAME SELECT/snapshot. A filtered RLS
// read or writable transaction never yields an accepted report.
const GUARD = `current_user = 'supabase_read_only_user'
  and pg_catalog.current_setting('transaction_read_only') = 'on'
  and not exists (
    select 1 from pg_catalog.unnest(array[
      'auth.users'::regclass,
      'auth.identities'::regclass,
      'auth.sessions'::regclass,
      'public.profiles'::regclass,
      'public.novels'::regclass,
      'public.episodes'::regclass,
      'public.novelight_ai_bible_facts'::regclass,
      'public.novelight_ai_episode_analysis'::regclass,
      'public.novelight_ai_review_candidates'::regclass,
      'public.novelight_ai_external_processing_consents'::regclass,
      'public.novelight_ai_external_consent_action_audit'::regclass,
      'public.novelight_ai_usage_requests'::regclass,
      'public.novelight_ai_usage_audit'::regclass,
      'public.novelight_ai_runtime_settings'::regclass,
      'public.novelight_ai_020705_one_shot_claims'::regclass,
      'public.novelight_ai_chunk_claims'::regclass
    ]) as t(rel)
    where pg_catalog.row_security_active(t.rel)
  )`;
const CENSUS_SQL = `
select census.*, (${GUARD}) as "readOnlyVerified",
 $1::uuid::text as "scopeActor", $2::bigint::text as "scopeNovel",
 $3::bigint::text as "scopeApproval", $4::bigint::text as "scopeEpisode",
 $5::text as "scopeMain", $6::text as "scopePreview"
from (select
 (select pg_catalog.count(*)::int from auth.users where id=$1::uuid) as "users",
 (select pg_catalog.count(*)::int from auth.identities where user_id=$1::uuid) as "identities",
 (select pg_catalog.count(*)::int from auth.sessions where user_id=$1::uuid) as "sessions",
 (select pg_catalog.count(*)::int from public.profiles where id=$1::uuid) as "profiles",
 (select pg_catalog.count(*)::int from public.novels where user_id=$1::uuid or id=$2::bigint) as "novels",
 (select pg_catalog.count(*)::int from public.episodes where user_id=$1::uuid or novel_id=$2::bigint or id=$4::bigint) as "episodes",
 (select pg_catalog.count(*)::int from public.novelight_ai_bible_facts where novel_id=$2::bigint or source_episode_id=$4::bigint) as "facts",
 (select pg_catalog.count(*)::int from public.novelight_ai_episode_analysis a where episode_id=$4::bigint or exists
   (select 1 from public.episodes e where e.id=a.episode_id and (e.novel_id=$2::bigint or e.user_id=$1::uuid))) as "analysis",
 (select pg_catalog.count(*)::int from public.novelight_ai_review_candidates where actor_id=$1::uuid or novel_id=$2::bigint or source_episode_id=$4::bigint) as "reviewCandidates",
 (select pg_catalog.count(*)::int from public.novelight_ai_external_processing_consents where actor_id=$1::uuid or novel_id=$2::bigint) as "consents",
 (select pg_catalog.count(*)::int from public.novelight_ai_external_consent_action_audit where actor_id=$1::uuid or novel_id=$2::bigint) as "consentAudit",
 (select pg_catalog.count(*)::int from public.novelight_ai_usage_requests where actor_id=$1::uuid or work_id=$2::bigint) as "usageRequests",
 (select pg_catalog.count(*)::int from public.novelight_ai_usage_audit where actor_id=$1::uuid or work_id=$2::bigint) as "usageAudit",
 (select pg_catalog.count(*)=1 from public.novelight_ai_runtime_settings where singleton=1 and enabled=false
   and user_day_cap_micros=0 and user_month_cap_micros=0 and global_day_cap_micros=0 and global_month_cap_micros=0) as "runtimeDisabledZero",
 (select pg_catalog.count(*)::int from public.novelight_ai_020705_one_shot_claims where approval_comment_id=$3::bigint
   and actor_id=$1::uuid and novel_id=$2::bigint and episode_id=$4::bigint
   and main_sha=$5 and preview_deployment_id=$6) as "approvalTombstoneCount",
 (select pg_catalog.count(*)::int from public.novelight_ai_chunk_claims where actor_id=$1::uuid or novel_id=$2::bigint) as "chunkClaimsRetained") as census
`;

async function fixedRead({ token, query, parameters, fetchImpl }) {
  validate020705CensusToken(token);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ query, parameters })
    });
    if (response?.status !== 201 ||
        !/^application\/json(?:\s*;|$)/iu.test(response.headers?.get('content-type') ?? '')) deny();
    const raw = await response.text();
    if (raw.length > 8192) deny();
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || Array.isArray(rows[0]) || rows[0].readOnlyVerified !== true) deny();
    return rows[0];
  } catch { deny(); }
}

// Credential probe does not read fixture data or assert full token scope.
export async function probe020705CensusAccess({ token, fetchImpl = globalThis.fetch } = {}) {
  const row = await fixedRead({
    token, query: 'select (' + GUARD + ') as "readOnlyVerified"',
    parameters: [], fetchImpl
  });
  if (Object.keys(row).length !== 1) deny();
  return true;
}

export function create020705IndependentCensusReader({ token, scope, fetchImpl = globalThis.fetch } = {}) {
  validate020705CensusToken(token);
  if (scope?.stagingProjectRef !== PROJECT || !UUID.test(scope.actorId ?? '') ||
      ![scope.novelId, scope.episodeId, scope.approvalCommentId].every(positive) ||
      !/^[a-f0-9]{40}$/u.test(scope.mainSha ?? '') ||
      !/^dpl_[A-Za-z0-9]+$/u.test(scope.previewDeploymentId ?? '') ||
      typeof fetchImpl !== 'function') deny();
  const pinned = Object.freeze({ ...scope });
  return async function independentCensus(target) {
    if (target?.projectRef !== PROJECT || target.userId !== pinned.actorId ||
        target.novelId !== pinned.novelId ||
        target.approvalCommentId !== pinned.approvalCommentId) deny();
    const parameters = [pinned.actorId, pinned.novelId, pinned.approvalCommentId,
      pinned.episodeId, pinned.mainSha, pinned.previewDeploymentId];
    const row = await fixedRead({ token, query: CENSUS_SQL, parameters, fetchImpl });
    const echoes = ['scopeActor', 'scopeNovel', 'scopeApproval', 'scopeEpisode', 'scopeMain', 'scopePreview'];
    if (Object.keys(row).length !== COUNTS.length + echoes.length + 2 ||
        echoes.some((key, i) => row[key] !== String(parameters[i])) ||
        typeof row.runtimeDisabledZero !== 'boolean' ||
        COUNTS.some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0)) deny();
    return Object.freeze({
      ...Object.fromEntries(COUNTS.map((key) => [key, row[key]])),
      runtimeDisabledZero: row.runtimeDisabledZero,
      projectRef: PROJECT, userId: pinned.actorId, novelId: pinned.novelId,
      approvalCommentId: pinned.approvalCommentId,
      sourceKind: 'SEPARATE_STAGING_READONLY_CENSUS'
    });
  };
}
