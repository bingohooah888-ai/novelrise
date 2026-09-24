-- Precheck for 20260924091509_harden_bulk_import_and_analytics_abuse.sql
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.bulk_import_events') is null
     or to_regclass('public.scout_record_usage_days') is null
     or to_regclass('public.acquisition_touches') is null
     or to_regclass('public.beta_activity_days') is null
     or to_regclass('public.reader_journey_events') is null
     or to_regclass('public.episode_pv_events') is null
     or to_regclass('public.neutral_search_impression_telemetry') is null then
    raise exception 'AUDIT-004/005 prerequisite tables are missing';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'pgcrypto digest(bytea,text) is required in the extensions schema';
  end if;

  if to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is null
     or to_regprocedure('public.novelight_bulk_import_episode_drafts(bigint,jsonb)') is null
     or to_regprocedure('public.novelight_record_bulk_import_event(text,bigint,integer)') is null
     or to_regprocedure('public.novelight_record_scout_record_visit()') is null
     or to_regprocedure('public.record_beta_visit(text,text,text)') is null
     or to_regprocedure('public.record_acquisition_touch(text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.record_reader_journey_event(text,text,text,text,text)') is null
     or to_regprocedure('public.record_episode_pv(text,text)') is null
     or to_regprocedure('public.record_neutral_search_impressions(text[],text)') is null then
    raise exception 'AUDIT-004/005 prerequisite RPCs are missing';
  end if;

  if to_regclass('public.bulk_import_requests') is not null
     or to_regprocedure(
       'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)'
     ) is not null then
    raise exception 'AUDIT-004/005 hardening already exists or needs reconciliation';
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.novels'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.episodes'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.bulk_import_events'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.scout_record_usage_days'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.acquisition_touches'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.beta_activity_days'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.reader_journey_events'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.episode_pv_events'::regclass) then
    raise exception 'Required RLS boundary is not enabled';
  end if;
end
$$;
