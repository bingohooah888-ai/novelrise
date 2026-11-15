-- NOVELIGHT AI 02-07-05: OFFLINE-ONLY PostgreSQL proposal.
-- NOT a migration. Never apply without new, environment-specific Staging approval.
-- This RPC is the PRE-PROVIDER one-time claim, NOT checkpoint completion CAS.
-- The existing novelight_ai_checkpoint_cas_v1 remains the ONLY completion writer.
--
-- Lock order must agree with CAS: novels FOR SHARE -> episodes FOR SHARE ->
-- episode_analysis FOR UPDATE -> new claim table's unique index.
-- The JS bridge calls claim BEFORE Router budget reservation and the provider.
-- A false result, SQL error, timeout, or lost response means NO paid retry.
--
-- Reconciliation: a persisted claim is intentionally permanent even if the
-- provider times out or the checkpoint did not advance. An operator must inspect
-- the trusted claim, provider execution/receipt, Router reservation/settlement,
-- staged candidates, and checkpoint state. A claim may be manually removed ONLY
-- after independent proof that no external call and no billable reservation
-- occurred, under separate explicit DB mutation approval. Unknown outcome:
-- retain claim, stop, never automatically release, retry, or re-bill.
--
-- Required before application: isolated Staging validation of function grants,
-- lock order/real concurrent transactions, manuscript JSON.stringify hash parity
-- (including escaping/Unicode), RLS/role checks, and rollback/retention policy.
begin;

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.novelight_ai_checkpoint_claim_once_v1(uuid,bigint,bigint,text,text,text,integer,text)'
     ) is not null
     or pg_catalog.to_regclass('public.novelight_ai_chunk_claims') is not null
     or pg_catalog.to_regclass('public.novelight_ai_episode_analysis') is null
     or pg_catalog.to_regclass('public.novels') is null
     or pg_catalog.to_regclass('public.episodes') is null
     or not pg_catalog.has_table_privilege('service_role','public.novels','SELECT')
     or not pg_catalog.has_any_column_privilege('service_role','public.novels','UPDATE')
     or not pg_catalog.has_table_privilege('service_role','public.episodes','SELECT')
     or not pg_catalog.has_any_column_privilege('service_role','public.episodes','UPDATE')
     or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_episode_analysis','SELECT')
     or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_episode_analysis','UPDATE')
     or not pg_catalog.has_schema_privilege('service_role','extensions','USAGE')
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
     or not coalesce(pg_catalog.has_function_privilege(
         'service_role',pg_catalog.to_regprocedure('extensions.digest(bytea,text)'),'EXECUTE'
       ),false)
  then
    raise exception using errcode='42501',message='AI chunk claim preflight denied';
  end if;
end;
$preflight$;

-- No client-visible policy: service_role is the sole DML role.
-- No UPDATE, DELETE or TRUNCATE grant for service_role. Claims are not leases.
create table public.novelight_ai_chunk_claims (
  actor_id uuid not null,
  novel_id bigint not null check (novel_id > 0),
  episode_id bigint not null check (episode_id > 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  previous_source_hash text check (previous_source_hash ~ '^[a-f0-9]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  chunk_index integer not null check (chunk_index between 0 and 63),
  chunk_hash text not null check (chunk_hash ~ '^[a-f0-9]{64}$'),
  claimed_at timestamptz not null default pg_catalog.now(),
  constraint novelight_ai_chunk_claims_pkey primary key
    (actor_id,novel_id,episode_id,source_hash,fingerprint,chunk_index)
);

alter table public.novelight_ai_chunk_claims enable row level security;
revoke all on table public.novelight_ai_chunk_claims from public,anon,authenticated,service_role;
grant select,insert on table public.novelight_ai_chunk_claims to service_role;

create function public.novelight_ai_checkpoint_claim_once_v1(
  p_actor_id uuid,
  p_novel_id bigint,
  p_episode_id bigint,
  p_source_hash text,
  p_previous_source_hash text,
  p_fingerprint text,
  p_chunk_index integer,
  p_chunk_hash text
) returns boolean language plpgsql security invoker set search_path = '' as $function$
declare
  v_sentinel text := pg_catalog.repeat('0',64);
  v_owner uuid;
  v_episode_novel_id bigint;
  v_title text;
  v_content text;
  v_current_hash text;
  v_row public.novelight_ai_episode_analysis%rowtype;
  v_progress jsonb;
  v_state text;
  v_count integer;
  v_index_text text;
  v_item jsonb;
  v_index integer;
  v_seen integer[] := array[]::integer[];
  v_inserted boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501',message='AI chunk claim service only';
  end if;
  if p_actor_id is null
     or p_novel_id is null or p_novel_id <= 0
     or p_episode_id is null or p_episode_id <= 0
     or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
     or p_source_hash = v_sentinel
     or (p_previous_source_hash is not null and
         (p_previous_source_hash !~ '^[a-f0-9]{64}$' or p_previous_source_hash = v_sentinel))
     or p_source_hash is not distinct from p_previous_source_hash
     or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
     or p_chunk_hash is null or p_chunk_hash !~ '^[a-f0-9]{64}$'
     or p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= 64
  then
    raise exception using errcode='22023',message='Invalid AI chunk claim input';
  end if;

  -- Locks prevent owner transfer, chapter edit, and episode deletion while
  -- this transaction validates source and admits a claim.
  select n.user_id into v_owner
    from public.novels n where n.id = p_novel_id for share;
  if not found or v_owner is distinct from p_actor_id then
    raise exception using errcode='42501',message='AI chunk claim owner denied';
  end if;

  select e.novel_id,e.title,e.content
    into v_episode_novel_id,v_title,v_content
    from public.episodes e where e.id = p_episode_id for share;
  if not found or v_episode_novel_id is distinct from p_novel_id
     or v_title is null or v_content is null
     or pg_catalog.octet_length(v_title) > 8192
     or pg_catalog.octet_length(v_content) > 1000000
  then
    raise exception using errcode='42501',message='AI chunk claim episode denied';
  end if;
  -- Must match CAS and JS sha256(JSON.stringify([title,content])).
  -- Exact hash parity is a required separate Staging gate.
  v_current_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(
      '[' || pg_catalog.to_json(v_title)::text || ',' ||
      pg_catalog.to_json(v_content)::text || ']','UTF8'
    ),'sha256'
  ),'hex');
  if v_current_hash is distinct from p_source_hash then
    raise exception using errcode='22023',message='AI chunk claim manuscript changed';
  end if;

  -- The checkpoint journal and the claim table are intentionally separate.
  -- Never advance a completed chunk or overwrite an unrelated CAS summary.
  select a.* into v_row from public.novelight_ai_episode_analysis a
    where a.episode_id = p_episode_id for update;
  if not found then
    if p_previous_source_hash is not null then
      return false; -- No verified baseline exists.
    end if;
  else
    if pg_catalog.jsonb_typeof(v_row.summary) is distinct from 'object' then
      raise exception using errcode='22023',message='Malformed checkpoint summary';
    end if;
    if v_row.source_hash = p_source_hash then
      return false; -- Already analyzed; no new paid attempt.
    end if;
    v_progress := v_row.summary -> 'novelightPhase2';
    if v_progress is null then
      if v_row.source_hash is distinct from p_previous_source_hash
         or p_previous_source_hash is null then
        return false;
      end if;
    else
      if pg_catalog.jsonb_typeof(v_progress) is distinct from 'object'
         or v_progress -> 'version' is distinct from '1'::jsonb
         or v_progress ->> 'actorId' is distinct from p_actor_id::text
         or v_progress -> 'novelId' is distinct from pg_catalog.to_jsonb(p_novel_id)
         or v_progress -> 'episodeId' is distinct from pg_catalog.to_jsonb(p_episode_id)
         or coalesce(pg_catalog.jsonb_typeof(v_progress -> 'previousSourceHash'),'missing')
              not in ('null','string')
         or pg_catalog.jsonb_typeof(v_progress -> 'targetSourceHash') is distinct from 'string'
         or pg_catalog.jsonb_typeof(v_progress -> 'fingerprint') is distinct from 'string'
         or pg_catalog.jsonb_typeof(v_progress -> 'chunkCount') is distinct from 'number'
         or v_progress ->> 'chunkCount' !~ '^(0|[1-9][0-9]?)$'
         or pg_catalog.jsonb_typeof(v_progress -> 'completedIndices') is distinct from 'array'
         or pg_catalog.jsonb_typeof(v_progress -> 'state') is distinct from 'string'
         or v_progress ->> 'state' not in ('in_progress','complete')
      then
        raise exception using errcode='22023',message='Malformed saved checkpoint';
      end if;
      v_state := v_progress ->> 'state';
      v_count := (v_progress ->> 'chunkCount')::integer;
      if v_count > 64 or
         (v_progress ->> 'targetSourceHash') !~ '^[a-f0-9]{64}$' or
         (v_progress ->> 'fingerprint') !~ '^[a-f0-9]{64}$' or
         (v_progress ->> 'previousSourceHash' is not null and
           v_progress ->> 'previousSourceHash' !~ '^[a-f0-9]{64}$')
      then
        raise exception using errcode='22023',message='Malformed saved source';
      end if;
      for v_item in select value
        from pg_catalog.jsonb_array_elements(v_progress -> 'completedIndices')
      loop
        v_index_text := v_item #>> '{}';
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'number'
           or v_index_text !~ '^(0|[1-9][0-9]?)$' then
          raise exception using errcode='22023',message='Invalid saved claim index';
        end if;
        v_index := v_index_text::integer;
        if v_index >= v_count or pg_catalog.array_position(v_seen,v_index) is not null then
          raise exception using errcode='22023',message='Duplicate saved claim index';
        end if;
        v_seen := pg_catalog.array_append(v_seen,v_index);
      end loop;
      if v_state = 'in_progress' then
        if v_count < 1 or pg_catalog.cardinality(v_seen) >= v_count
           or v_progress ? 'zeroReason'
           or v_progress ->> 'targetSourceHash' is distinct from p_source_hash
           or v_progress ->> 'previousSourceHash' is distinct from p_previous_source_hash
           or v_progress ->> 'fingerprint' is distinct from p_fingerprint
           or v_row.source_hash is distinct from coalesce(p_previous_source_hash,v_sentinel)
           or p_chunk_index >= v_count
           or pg_catalog.array_position(v_seen,p_chunk_index) is not null
        then
          return false;
        end if;
      else
        -- A completed PRIOR version is a valid baseline for a NEW version.
        -- A completed target cannot be re-claimed; matching current source
        -- already returned false above.
        if v_count < 0 or pg_catalog.cardinality(v_seen) <> v_count
           or (v_count = 0 and
               (v_progress ->> 'zeroReason' not in ('empty-body','deletion-only','title-only')
                or pg_catalog.jsonb_typeof(v_progress -> 'zeroReason') is distinct from 'string'))
           or (v_count > 0 and v_progress ? 'zeroReason')
           or v_row.source_hash is distinct from p_previous_source_hash
           or v_progress ->> 'targetSourceHash' is distinct from v_row.source_hash
           or p_previous_source_hash is null
        then
          return false;
        end if;
      end if;
    end if;
  end if;

  -- A unique insert is the linearization point. A committed claim is never
  -- deleted or leased back automatically, including on provider uncertainty.
  insert into public.novelight_ai_chunk_claims
    (actor_id,novel_id,episode_id,source_hash,previous_source_hash,
     fingerprint,chunk_index,chunk_hash)
  values
    (p_actor_id,p_novel_id,p_episode_id,p_source_hash,p_previous_source_hash,
     p_fingerprint,p_chunk_index,p_chunk_hash)
  on conflict on constraint novelight_ai_chunk_claims_pkey do nothing
  returning true into v_inserted;
  return coalesce(v_inserted,false);
end;
$function$;

revoke all on function public.novelight_ai_checkpoint_claim_once_v1(
  uuid,bigint,bigint,text,text,text,integer,text
) from public,anon,authenticated;
grant execute on function public.novelight_ai_checkpoint_claim_once_v1(
  uuid,bigint,bigint,text,text,text,integer,text
) to service_role;

commit;
