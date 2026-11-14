-- Trusted Staging recovery kit. Read-only precheck for the missing canonical
-- migration 20261110172000. Never change migration history to fake parity.
-- Generated from actual Staging pg_get_functiondef() hashes on 2026-11-14.
DO $retention_precheck$
DECLARE
  v_funnel oid := pg_catalog.to_regprocedure('public.novelight_author_exposure_funnel_v2(integer)');
  v_series oid := pg_catalog.to_regprocedure('public.novelight_author_analytics_timeseries(integer)');
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
             WHERE version::text='20261110172000') THEN
    RAISE EXCEPTION 'Retention migration already recorded; no replay';
  END IF;
  IF v_funnel IS NULL OR v_series IS NULL THEN
    RAISE EXCEPTION 'Retention precheck: baseline functions missing';
  END IF;
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_funnel),'UTF8')),'hex') <> '84db65f80613f2e1e15cab8f66c973981bdd56260ac3b866da66b29284c67653'
     OR encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_series),'UTF8')),'hex') <> 'e2879f44469f2cc5d4f33d5969a4b8a85ae17fa13ffb50e93c87fa136be943c3' THEN
    RAISE EXCEPTION 'Retention precheck: Staging function definition drift';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_funnel)
    OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_series)
    OR pg_catalog.has_function_privilege('anon',v_funnel,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_series,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',v_funnel,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',v_series,'EXECUTE') THEN
    RAISE EXCEPTION 'Retention precheck: RPC security/permission drift';
  END IF;
END
$retention_precheck$;
