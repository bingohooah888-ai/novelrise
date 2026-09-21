-- Postcheck for 20260921120552_bulk_episode_import.sql
do $$
declare
  v_events_rls boolean;
begin
  if to_regclass('public.bulk_import_events') is null then
    raise exception 'bulk_import_events table is missing';
  end if;

  select relrowsecurity
  into v_events_rls
  from pg_class
  where oid = 'public.bulk_import_events'::regclass;

  if not coalesce(v_events_rls, false) then
    raise exception 'bulk_import_events RLS must be enabled';
  end if;

  if to_regprocedure('public.novelight_bulk_import_episode_drafts(bigint,jsonb)') is null
     or to_regprocedure('public.novelight_record_bulk_import_event(text,bigint,integer)') is null then
    raise exception 'Bulk import RPCs are missing';
  end if;

  if to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is null then
    raise exception 'Existing beta import RPC must remain available';
  end if;

  if has_function_privilege(
      'anon',
      'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
      'EXECUTE'
    ) then
    raise exception 'anon must not execute bulk import RPC';
  end if;

  if has_function_privilege(
      'anon',
      'public.novelight_record_bulk_import_event(text,bigint,integer)',
      'EXECUTE'
    ) then
    raise exception 'anon must not execute bulk import analytics RPC';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
      'EXECUTE'
    ) then
    raise exception 'authenticated must execute bulk import RPC';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.novelight_record_bulk_import_event(text,bigint,integer)',
      'EXECUTE'
    ) then
    raise exception 'authenticated must execute bulk import analytics RPC';
  end if;

  if has_table_privilege('anon', 'public.bulk_import_events', 'SELECT')
     or has_table_privilege('anon', 'public.bulk_import_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.bulk_import_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.bulk_import_events', 'INSERT') then
    raise exception 'Raw bulk import analytics table must stay closed';
  end if;
end
$$;
