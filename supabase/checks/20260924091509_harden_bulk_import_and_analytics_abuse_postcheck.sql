-- Postcheck for 20260924091509_harden_bulk_import_and_analytics_abuse.sql
do $$
declare
  v_signature text;
  v_definition text;
begin
  if to_regclass('public.bulk_import_requests') is null then
    raise exception 'bulk_import_requests is missing';
  end if;

  if not (
    select c.relrowsecurity
      from pg_catalog.pg_class c
     where c.oid = 'public.bulk_import_requests'::regclass
  ) then
    raise exception 'bulk_import_requests RLS must be enabled';
  end if;

  if not (
    select c.relrowsecurity
      from pg_catalog.pg_class c
     where c.oid = 'public.neutral_search_impression_telemetry'::regclass
  ) then
    raise exception 'neutral_search_impression_telemetry RLS must be enabled';
  end if;

  if has_table_privilege(
       'anon',
       'public.neutral_search_impression_telemetry',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'authenticated',
       'public.neutral_search_impression_telemetry',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'Client roles must not access raw neutral search telemetry';
  end if;

  if has_table_privilege('anon', 'public.bulk_import_requests', 'SELECT')
     or has_table_privilege('anon', 'public.bulk_import_requests', 'INSERT')
     or has_table_privilege('anon', 'public.bulk_import_requests', 'UPDATE')
     or has_table_privilege('anon', 'public.bulk_import_requests', 'DELETE')
     or has_table_privilege('authenticated', 'public.bulk_import_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.bulk_import_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.bulk_import_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.bulk_import_requests', 'DELETE') then
    raise exception 'Client roles must not access raw bulk import request audit rows';
  end if;

  if not has_table_privilege('service_role', 'public.bulk_import_requests', 'SELECT')
     or not has_table_privilege('service_role', 'public.bulk_import_requests', 'INSERT')
     or not has_table_privilege('service_role', 'public.bulk_import_requests', 'UPDATE')
     or not has_table_privilege('service_role', 'public.bulk_import_requests', 'DELETE') then
    raise exception 'service_role must retain operational access to bulk import request audit rows';
  end if;

  if to_regprocedure(
    'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)'
  ) is null then
    raise exception 'Internal bulk import quota reservation helper is missing';
  end if;

  if has_function_privilege(
      'anon',
      'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)',
      'EXECUTE'
    )
     or has_function_privilege(
       'authenticated',
       'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)',
       'EXECUTE'
     ) then
    raise exception 'Internal quota reservation helper must not be directly executable';
  end if;

  foreach v_signature in array array[
    'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
    'public.novelight_import_episode_drafts(bigint,jsonb)',
    'public.novelight_record_bulk_import_event(text,bigint,integer)',
    'public.novelight_record_scout_record_visit()',
    'public.record_beta_visit(text,text,text)',
    'public.record_acquisition_touch(text,text,text,text,text,text,text)',
    'public.record_reader_journey_event(text,text,text,text,text)',
    'public.record_episode_pv(text,text)',
    'public.record_neutral_search_impressions(text[],text)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required hardened RPC is missing: %', v_signature;
    end if;

    if not (
      select p.prosecdef
        from pg_catalog.pg_proc p
       where p.oid = v_signature::regprocedure
    ) then
      raise exception 'Hardened RPC must be SECURITY DEFINER: %', v_signature;
    end if;

    if not exists (
      select 1
        from pg_catalog.pg_proc p
       where p.oid = v_signature::regprocedure
         and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'Hardened RPC must pin an empty search_path: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
      'anon',
      'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
      'EXECUTE'
    )
     or has_function_privilege(
       'anon',
       'public.novelight_import_episode_drafts(bigint,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_record_bulk_import_event(text,bigint,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_record_scout_record_visit()',
       'EXECUTE'
     ) then
    raise exception 'anon must not execute authenticated bulk/SCOUT RPCs';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
      'EXECUTE'
    )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_import_episode_drafts(bigint,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_record_bulk_import_event(text,bigint,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_record_scout_record_visit()',
       'EXECUTE'
     ) then
    raise exception 'authenticated must retain the intended bulk/SCOUT RPC access';
  end if;

  if has_function_privilege('anon', 'public.record_beta_visit(text,text,text)', 'EXECUTE')
     or has_function_privilege(
       'anon',
       'public.record_acquisition_touch(text,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.record_acquisition_touch(text,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.record_reader_journey_event(text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.record_episode_pv(text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.record_neutral_search_impressions(text[],text)',
       'EXECUTE'
     ) then
    raise exception 'Anonymous analytics RPC access must be closed behind the server boundary';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.record_beta_visit(text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_beta_visit(text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_acquisition_touch(text,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.record_reader_journey_event(text,text,text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_reader_journey_event(text,text,text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.record_episode_pv(text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_episode_pv(text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.record_neutral_search_impressions(text[],text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_neutral_search_impressions(text[],text)',
       'EXECUTE'
     ) then
    raise exception 'Server analytics boundary privileges are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, 'interval ''10 minutes''') = 0
     or pg_catalog.strpos(v_definition, 'v_daily_count >= 20') = 0
     or pg_catalog.strpos(v_definition, 'v_daily_episode_count + p_episode_count > 1000') = 0
     or pg_catalog.strpos(v_definition, 'v_daily_body_chars + p_body_char_count > 20000000') = 0
     or pg_catalog.strpos(v_definition, 'v_draft_count + p_episode_count > 2000') = 0
     or pg_catalog.strpos(v_definition, 'interval ''24 hours''') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0 then
    raise exception 'Bulk import quota, replay, or concurrency controls are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.novelight_bulk_import_episode_drafts(bigint,jsonb)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, '5000000 characters') = 0
     or pg_catalog.strpos(v_definition, '20000000 bytes') = 0
     or pg_catalog.strpos(v_definition, 'extensions.digest') = 0 then
    raise exception 'Bulk import payload bounds or fingerprint are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.novelight_record_bulk_import_event(text,bigint,integer)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, 'interval ''5 minutes''') = 0
     or pg_catalog.strpos(v_definition, 'interval ''10 minutes''') = 0
     or pg_catalog.strpos(v_definition, '>= 200') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0 then
    raise exception 'Bulk analytics dedupe/rate controls are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.record_reader_journey_event(text,text,text,text,text)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, 'interval ''1 hour''') = 0
     or pg_catalog.strpos(v_definition, '>= 120') = 0
     or pg_catalog.strpos(v_definition, '>= 1000') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0 then
    raise exception 'Reader journey dedupe/rate controls are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.record_episode_pv(text,text)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, 'interval ''6 hours''') = 0
     or pg_catalog.strpos(v_definition, '>= 120') = 0
     or pg_catalog.strpos(v_definition, '>= 500') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0 then
    raise exception 'Episode PV dedupe/rate controls are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.record_neutral_search_impressions(text[],text)'::regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, '> 200') = 0
     or pg_catalog.strpos(v_definition, '> 2000') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0 then
    raise exception 'Neutral search dedupe/rate controls are incomplete';
  end if;
end
$$;
