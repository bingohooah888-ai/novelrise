-- NOVELIGHT 02-07-05 CHECKPOINT P0: OFFLINE SQL PROPOSAL ONLY.
-- NOT a migration. DO NOT APPLY without dedicated Staging approval.
-- One transaction must hold owner and manuscript locks until the CAS commits.
-- Never expose to anon/authenticated. No public route activates this RPC.
begin;

-- Fail closed if the target lacks the minimum privileges for SECURITY INVOKER.
do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.novelight_ai_checkpoint_cas_v1(uuid,bigint,bigint,text,text,integer,text,text,jsonb,integer)'
     ) is not null
     or pg_catalog.to_regclass('public.novelight_ai_episode_analysis') is null
     or not pg_catalog.has_table_privilege('service_role','public.novels','SELECT')
     or not pg_catalog.has_any_column_privilege('service_role','public.novels','UPDATE')
     or not pg_catalog.has_table_privilege('service_role','public.episodes','SELECT')
     or not pg_catalog.has_any_column_privilege('service_role','public.episodes','UPDATE')
     or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_episode_analysis','SELECT')
     or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_episode_analysis','INSERT')
     or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_episode_analysis','UPDATE')
     or not pg_catalog.has_schema_privilege('service_role','extensions','USAGE')
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
     or not pg_catalog.coalesce(pg_catalog.has_function_privilege(
       'service_role', pg_catalog.to_regprocedure('extensions.digest(bytea,text)'), 'EXECUTE'
     ), false)
  then
    raise exception using errcode = '42501', message = 'AI checkpoint preflight denied';
  end if;
end;
$preflight$;

create function public.novelight_ai_checkpoint_cas_v1(
  p_actor_id uuid,
  p_novel_id bigint,
  p_episode_id bigint,
  p_action text,
  p_target_source_hash text,
  p_expected_revision integer,
  p_expected_source_hash text,
  p_next_source_hash text,
  p_next_progress jsonb,
  p_chunk_index integer
) returns table (
  episode_id bigint,
  source_hash text,
  revision integer,
  summary jsonb
) language plpgsql security invoker set search_path = '' as $function$
declare
  v_sentinel text := pg_catalog.repeat('0',64);
  v_novel_owner uuid;
  v_episode_novel_id bigint;
  v_title text;
  v_content text;
  v_current_hash text;
  v_row public.novelight_ai_episode_analysis%rowtype;
  v_has_row boolean := false;
  v_old jsonb;
  v_old_state text;
  v_old_previous text;
  v_old_target text;
  v_old_fingerprint text;
  v_old_count integer;
  v_old_indices integer[] := array[]::integer[];
  v_next_previous text;
  v_next_target text;
  v_next_fingerprint text;
  v_next_state text;
  v_next_count integer;
  v_next_indices integer[] := array[]::integer[];
  v_zero_reason text;
  v_item jsonb;
  v_str text;
  v_i integer;
  v_key_count integer;
  v_expected_indices integer[] := array[]::integer[];
  v_next_expected_hash text;
  v_next_summary jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501', message='AI checkpoint service only';
  end if;
  if p_actor_id is null or p_novel_id is null or p_novel_id <= 0
     or p_episode_id is null or p_episode_id <= 0
     or p_action is null or p_action not in ('record','replan','complete_empty','discard_restored')
     or p_target_source_hash is null or p_target_source_hash !~ '^[a-f0-9]{64}$'
     or p_target_source_hash = v_sentinel
     or p_next_source_hash is null or p_next_source_hash !~ '^[a-f0-9]{64}$'
     or (p_expected_revision is null) <> (p_expected_source_hash is null)
     or (p_expected_revision is not null and (
       p_expected_revision < 1 or p_expected_revision = 2147483647
       or p_expected_source_hash !~ '^[a-f0-9]{64}$'
     ))
     or (p_action = 'record' and (p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= 64))
     or (p_action <> 'record' and p_chunk_index is not null)
  then
    raise exception using errcode='22023', message='Invalid AI checkpoint CAS input';
  end if;

  -- Lock order: novel then episode then analysis. A concurrent owner transfer,
  -- manuscript edit, episode deletion or work deletion must wait for commit.
  select n.user_id into v_novel_owner from public.novels n
  where n.id = p_novel_id for share;
  if not found or v_novel_owner is distinct from p_actor_id then
    raise exception using errcode='42501', message='AI checkpoint owner denied';
  end if;
  select e.novel_id,e.title,e.content
    into v_episode_novel_id,v_title,v_content
  from public.episodes e where e.id = p_episode_id for share;
  if not found or v_episode_novel_id is distinct from p_novel_id
     or v_title is null or v_content is null
     or pg_catalog.octet_length(v_title) > 8192
     or pg_catalog.octet_length(v_content) > 1000000
  then
    raise exception using errcode='42501', message='AI checkpoint episode denied';
  end if;
  -- Identical serialization to JSON.stringify([title, content]) is a
  -- mandatory Staging hash-parity gate before applying this proposal.
  v_current_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(
      '[' || pg_catalog.to_json(v_title)::text || ',' ||
      pg_catalog.to_json(v_content)::text || ']', 'UTF8'
    ), 'sha256'
  ),'hex');
  if v_current_hash is distinct from p_target_source_hash then
    raise exception using errcode='22023', message='AI checkpoint manuscript changed';
  end if;

  select a.* into v_row from public.novelight_ai_episode_analysis a
  where a.episode_id = p_episode_id for update;
  v_has_row := found;
  if (p_expected_revision is null and v_has_row)
     or (p_expected_revision is not null and (
       not v_has_row or v_row.revision is distinct from p_expected_revision
       or v_row.source_hash is distinct from p_expected_source_hash
     ))
  then
    return; -- CAS conflict, never retry automatically
  end if;

  if v_has_row then
    v_old := v_row.summary -> 'novelightPhase2';
  end if;
  if v_old is not null then
    if pg_catalog.jsonb_typeof(v_old) is distinct from 'object'
       or v_old -> 'version' is distinct from '1'::jsonb
       or v_old ->> 'actorId' is distinct from p_actor_id::text
       or v_old -> 'novelId' is distinct from pg_catalog.to_jsonb(p_novel_id)
       or v_old -> 'episodeId' is distinct from pg_catalog.to_jsonb(p_episode_id)
       or pg_catalog.jsonb_typeof(v_old -> 'state') is distinct from 'string'
       or v_old ->> 'state' not in ('in_progress','complete')
       or pg_catalog.jsonb_typeof(v_old -> 'targetSourceHash') is distinct from 'string'
       or v_old ->> 'targetSourceHash' !~ '^[a-f0-9]{64}$'
       or pg_catalog.jsonb_typeof(v_old -> 'fingerprint') is distinct from 'string'
       or v_old ->> 'fingerprint' !~ '^[a-f0-9]{64}$'
       or pg_catalog.jsonb_typeof(v_old -> 'previousSourceHash') not in ('null','string')
       or pg_catalog.jsonb_typeof(v_old -> 'chunkCount') is distinct from 'number'
       or v_old ->> 'chunkCount' !~ '^(0|[1-9][0-9]?)$'
       or pg_catalog.jsonb_typeof(v_old -> 'completedIndices') is distinct from 'array'
    then
      raise exception using errcode='22023', message='Invalid AI checkpoint saved journal';
    end if;
    v_old_state := v_old ->> 'state';
    v_old_previous := v_old ->> 'previousSourceHash';
    v_old_target := v_old ->> 'targetSourceHash';
    v_old_fingerprint := v_old ->> 'fingerprint';
    v_old_count := (v_old ->> 'chunkCount')::integer;
    if v_old_count > 64 or v_old_target = v_sentinel
       or (v_old_previous is not null and
         (v_old_previous !~ '^[a-f0-9]{64}$' or v_old_previous = v_sentinel))
       or (v_old_state = 'in_progress' and (
         v_old_count < 1 or v_row.source_hash is distinct from
           pg_catalog.coalesce(v_old_previous,v_sentinel) or v_old ? 'zeroReason'
       ))
       or (v_old_state = 'complete' and v_row.source_hash is distinct from v_old_target)
       or (v_old_count = 0 and (
         v_old_state <> 'complete' or v_old ->> 'zeroReason' not in
         ('empty-body','deletion-only','title-only')
       ))
       or (v_old_count > 0 and v_old ? 'zeroReason')
    then
      raise exception using errcode='22023', message='Inconsistent AI checkpoint saved source';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_old -> 'completedIndices') loop
      v_str := v_item #>> '{}';
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'number'
         or v_str !~ '^(0|[1-9][0-9]?)$' then
        raise exception using errcode='22023', message='Invalid saved chunk index';
      end if;
      v_i := v_str::integer;
      if v_i >= v_old_count or pg_catalog.array_position(v_old_indices,v_i) is not null then
        raise exception using errcode='22023', message='Duplicate or out of range saved chunk';
      end if;
      v_old_indices := pg_catalog.array_append(v_old_indices,v_i);
    end loop;
    if (v_old_state = 'complete' and pg_catalog.cardinality(v_old_indices) <> v_old_count)
       or (v_old_state = 'in_progress' and pg_catalog.cardinality(v_old_indices) >= v_old_count)
    then
      raise exception using errcode='22023', message='Invalid saved completion count';
    end if;
  end if;

  if p_action = 'discard_restored' then
    if p_next_progress is not null or p_chunk_index is not null
       or not v_has_row or v_old is null or v_old_state <> 'in_progress'
       or v_old_previous is distinct from p_target_source_hash
       or v_old_target = p_target_source_hash
       or v_row.source_hash is distinct from p_target_source_hash
       or p_next_source_hash is distinct from p_target_source_hash
    then
      raise exception using errcode='22023', message='Invalid restored checkpoint';
    end if;
    v_next_summary := v_row.summary - 'novelightPhase2';
  else
    -- Validate the complete next plan; the DB updates ONLY this JSON key.
    if pg_catalog.jsonb_typeof(p_next_progress) is distinct from 'object'
       or pg_catalog.octet_length(p_next_progress::text) > 8192 then
      raise exception using errcode='22023', message='Invalid next journal';
    end if;
    select pg_catalog.count(*) into v_key_count
      from pg_catalog.jsonb_object_keys(p_next_progress);
    if v_key_count not in (10,11)
       or p_next_progress -> 'version' is distinct from '1'::jsonb
       or pg_catalog.jsonb_typeof(p_next_progress -> 'state') is distinct from 'string'
       or p_next_progress ->> 'state' not in ('in_progress','complete')
       or p_next_progress ->> 'actorId' is distinct from p_actor_id::text
       or p_next_progress -> 'novelId' is distinct from pg_catalog.to_jsonb(p_novel_id)
       or p_next_progress -> 'episodeId' is distinct from pg_catalog.to_jsonb(p_episode_id)
       or pg_catalog.jsonb_typeof(p_next_progress -> 'previousSourceHash') not in ('null','string')
       or pg_catalog.jsonb_typeof(p_next_progress -> 'targetSourceHash') is distinct from 'string'
       or p_next_progress ->> 'targetSourceHash' is distinct from p_target_source_hash
       or pg_catalog.jsonb_typeof(p_next_progress -> 'fingerprint') is distinct from 'string'
       or p_next_progress ->> 'fingerprint' !~ '^[a-f0-9]{64}$'
       or pg_catalog.jsonb_typeof(p_next_progress -> 'chunkCount') is distinct from 'number'
       or p_next_progress ->> 'chunkCount' !~ '^(0|[1-9][0-9]?)$'
       or pg_catalog.jsonb_typeof(p_next_progress -> 'completedIndices') is distinct from 'array'
    then
      raise exception using errcode='22023', message='Malformed next checkpoint';
    end if;
    v_next_previous := p_next_progress ->> 'previousSourceHash';
    v_next_target := p_next_progress ->> 'targetSourceHash';
    v_next_fingerprint := p_next_progress ->> 'fingerprint';
    v_next_count := (p_next_progress ->> 'chunkCount')::integer;
    v_next_state := p_next_progress ->> 'state';
    v_zero_reason := p_next_progress ->> 'zeroReason';
    if v_next_count > 64 or v_next_target = v_sentinel
       or v_next_target is not distinct from v_next_previous
       or (v_next_previous is not null and
          (v_next_previous !~ '^[a-f0-9]{64}$' or v_next_previous = v_sentinel))
    then
      raise exception using errcode='22023', message='Invalid source pair';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_next_progress -> 'completedIndices') loop
      v_str := v_item #>> '{}';
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'number'
         or v_str !~ '^(0|[1-9][0-9]?)$' then
        raise exception using errcode='22023', message='Malformed completed index';
      end if;
      v_i := v_str::integer;
      if v_i >= v_next_count or pg_catalog.array_position(v_next_indices,v_i) is not null then
        raise exception using errcode='22023', message='Duplicate completed index';
      end if;
      v_next_indices := pg_catalog.array_append(v_next_indices,v_i);
    end loop;
    if v_next_count = 0 then
      if p_action <> 'complete_empty' or v_next_state <> 'complete'
         or pg_catalog.cardinality(v_next_indices) <> 0
         or v_key_count <> 11 or
         pg_catalog.jsonb_typeof(p_next_progress -> 'zeroReason') is distinct from 'string'
         or v_zero_reason not in ('empty-body','deletion-only','title-only')
         or (v_zero_reason = 'empty-body' and v_content <> '')
         or (v_zero_reason <> 'empty-body' and v_next_previous is null)
      then
        raise exception using errcode='22023', message='Invalid zero chunk transition';
      end if;
    elsif p_action = 'complete_empty' or v_key_count <> 10
       or p_next_progress ? 'zeroReason'
       or p_action <> 'replan' and (
          (v_next_state = 'complete' and
             pg_catalog.cardinality(v_next_indices) <> v_next_count)
          or (v_next_state = 'in_progress' and
             pg_catalog.cardinality(v_next_indices) >= v_next_count)
       )
    then
      raise exception using errcode='22023', message='Invalid chunk completion count';
    end if;

    if p_action = 'replan' then
      if not v_has_row or v_old is null or v_old_state <> 'in_progress'
         or v_old_previous is distinct from v_next_previous
         or (v_old_target = v_next_target and
             v_old_fingerprint = v_next_fingerprint and v_old_count = v_next_count)
         or v_next_state <> 'in_progress'
         or pg_catalog.cardinality(v_next_indices) <> 0
      then
        raise exception using errcode='22023', message='Invalid replan transition';
      end if;
      v_next_expected_hash := pg_catalog.coalesce(v_next_previous,v_sentinel);
    elsif p_action = 'record' or p_action = 'complete_empty' then
      if v_old is not null then
        if v_old_state = 'in_progress' then
          if v_old_previous is distinct from v_next_previous then
            raise exception using errcode='22023', message='Different baseline';
          end if;
          if p_action = 'record' and (
              v_old_target is distinct from v_next_target
              or v_old_fingerprint is distinct from v_next_fingerprint
              or v_old_count is distinct from v_next_count)
          then
            raise exception using errcode='22023', message='Different incomplete plan';
          end if;
          v_expected_indices := v_old_indices;
        elsif v_old_state = 'complete' then
          if v_row.source_hash is distinct from v_next_previous then
            raise exception using errcode='22023', message='Different completed baseline';
          end if;
        end if;
      elsif (v_has_row and v_row.source_hash is distinct from v_next_previous)
        or (not v_has_row and v_next_previous is not null)
      then
        raise exception using errcode='22023', message='Missing prior checkpoint';
      end if;
      if p_action = 'record' then
        if p_chunk_index >= v_next_count
           or pg_catalog.array_position(v_expected_indices,p_chunk_index) is not null
        then
          raise exception using errcode='22023', message='Repeated or invalid chunk';
        end if;
        v_expected_indices := pg_catalog.array_append(v_expected_indices,p_chunk_index);
        select pg_catalog.array_agg(i order by i) into v_expected_indices
          from pg_catalog.unnest(v_expected_indices) as x(i);
        if v_next_indices is distinct from v_expected_indices then
          raise exception using errcode='22023', message='Unacknowledged chunk jump';
        end if;
        if pg_catalog.cardinality(v_next_indices) = v_next_count then
          if v_next_state <> 'complete' then
            raise exception using errcode='22023', message='Premature incomplete state';
          end if;
        elsif v_next_state <> 'in_progress' then
          raise exception using errcode='22023', message='Premature completion';
        end if;
      end if;
      v_next_expected_hash := case when v_next_state = 'complete' then
        v_next_target else pg_catalog.coalesce(v_next_previous,v_sentinel) end;
    end if;

    if v_next_expected_hash is distinct from p_next_source_hash then
      raise exception using errcode='22023', message='Checkpoint source hash tampering';
    end if;
    v_next_summary := pg_catalog.jsonb_set(
      pg_catalog.coalesce(v_row.summary, '{}'::jsonb),
      '{novelightPhase2}', p_next_progress, true
    );
  end if;

  if not v_has_row then
    if p_action not in ('record','complete_empty') then
      raise exception using errcode='22023', message='Cannot initialize checkpoint';
    end if;
    return query
      insert into public.novelight_ai_episode_analysis as a
        (episode_id,source_hash,revision,summary)
      values (p_episode_id,p_next_source_hash,1,v_next_summary)
      on conflict (episode_id) do nothing
      returning a.episode_id,a.source_hash,a.revision,a.summary;
    return;
  end if;

  return query
    update public.novelight_ai_episode_analysis as a
      set source_hash = p_next_source_hash,
          summary = v_next_summary,
          revision = a.revision + 1,
          analyzed_at = pg_catalog.now()
    where a.episode_id = p_episode_id
      and a.revision = p_expected_revision
      and a.source_hash = p_expected_source_hash
      and a.revision < 2147483647
    returning a.episode_id,a.source_hash,a.revision,a.summary;
end;
$function$;

revoke all on function public.novelight_ai_checkpoint_cas_v1(
  uuid,bigint,bigint,text,text,integer,text,text,jsonb,integer
) from public, anon, authenticated;
grant execute on function public.novelight_ai_checkpoint_cas_v1(
  uuid,bigint,bigint,text,text,integer,text,text,jsonb,integer
) to service_role;

commit;
