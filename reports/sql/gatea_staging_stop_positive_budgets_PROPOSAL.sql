-- PROPOSAL ONLY. Never auto-apply; not a Supabase migration.
-- Target ONLY Supabase Staging project wmlzjgvxgoyrovdhbqbg.
-- Requires separate OWNER approval, Staging-specific connection verification,
-- and pre-application OFF / four budgets=0 readback.
-- No Cloudflare, Production, paid POST, roles, grants, secrets or sessions changed.
-- This keeps the existing private SECURITY DEFINER function and its ACLs.
-- The only intended behavior change is removing the four zero-cap predicates
-- from the UPDATE's WHERE clause. STOP itself writes OFF and four zero caps.

BEGIN;

DO $gatea_preflight$
DECLARE
  function_ok boolean;
  role_ok boolean;
  settings_ok boolean;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'GATEA_STOP_MIGRATION_OWNER_NO_GO';
  END IF;

  SELECT p.prosecdef
     AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     AND p.proconfig @> ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),
           'AND user_day_cap_micros = 0') > 0
     AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),
           'AND user_month_cap_micros = 0') > 0
     AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),
           'AND global_day_cap_micros = 0') > 0
     AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),
           'AND global_month_cap_micros = 0') > 0
    INTO function_ok
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'gatea_stop_private.stop_once()'::regprocedure;
  IF function_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'GATEA_STOP_MIGRATION_FUNCTION_DRIFT_NO_GO';
  END IF;

  SELECT rolcanlogin AND NOT rolinherit
     AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    INTO role_ok
    FROM pg_catalog.pg_roles
   WHERE rolname = 'novelight_gatea_stop';
  IF role_ok IS DISTINCT FROM TRUE
     OR NOT pg_catalog.has_function_privilege(
       'novelight_gatea_stop', 'gatea_stop_private.stop_once()', 'EXECUTE')
     OR pg_catalog.has_table_privilege(
       'novelight_gatea_stop', 'public.novelight_ai_runtime_settings', 'UPDATE')
  THEN
    RAISE EXCEPTION 'GATEA_STOP_MIGRATION_ROLE_NO_GO';
  END IF;

  SELECT pg_catalog.count(*) = 1
     AND coalesce(pg_catalog.bool_and(
       singleton = 1 AND enabled IS FALSE
       AND user_day_cap_micros = 0 AND user_month_cap_micros = 0
       AND global_day_cap_micros = 0 AND global_month_cap_micros = 0
     ), false)
    INTO settings_ok
    FROM public.novelight_ai_runtime_settings;
  IF settings_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'GATEA_STOP_MIGRATION_NOT_SAFELY_OFF_NO_GO';
  END IF;
END
$gatea_preflight$;

CREATE OR REPLACE FUNCTION gatea_stop_private.stop_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE affected integer;
BEGIN
  IF session_user <> 'novelight_gatea_stop' THEN
    RAISE EXCEPTION 'GATEA_STOP_CALLER_NO_GO' USING ERRCODE = '42501';
  END IF;

  UPDATE public.novelight_ai_runtime_settings
     SET enabled = false,
         user_day_cap_micros = 0,
         user_month_cap_micros = 0,
         global_day_cap_micros = 0,
         global_month_cap_micros = 0,
         updated_at = pg_catalog.now()
   WHERE singleton = 1
     AND enabled IS TRUE;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'GATEA_STOP_EXPECTED_ONE_ARMED_ROW_NO_GO';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.novelight_ai_runtime_settings
     WHERE singleton = 1 AND enabled IS FALSE
       AND user_day_cap_micros = 0 AND user_month_cap_micros = 0
       AND global_day_cap_micros = 0 AND global_month_cap_micros = 0
  ) THEN
    RAISE EXCEPTION 'GATEA_STOP_VERIFY_NO_GO';
  END IF;
END
$function$;

COMMIT;

-- ROLLBACK (commented deliberately, NEVER run automatically).
-- Only after OWNER approval and Staging OFF/four budgets=0 readback:
-- apply the following exact original function definition in a single Staging
-- transaction, then verify original owner/ACL and OFF/four budgets=0 again.
/*
BEGIN;
CREATE OR REPLACE FUNCTION gatea_stop_private.stop_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE affected integer;
BEGIN
  IF session_user <> 'novelight_gatea_stop' THEN
    RAISE EXCEPTION 'GATEA_STOP_CALLER_NO_GO' USING ERRCODE = '42501';
  END IF;

  UPDATE public.novelight_ai_runtime_settings
     SET enabled = false,
         user_day_cap_micros = 0,
         user_month_cap_micros = 0,
         global_day_cap_micros = 0,
         global_month_cap_micros = 0,
         updated_at = pg_catalog.now()
   WHERE singleton = 1
     AND enabled IS TRUE
     AND user_day_cap_micros = 0
     AND user_month_cap_micros = 0
     AND global_day_cap_micros = 0
     AND global_month_cap_micros = 0;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'GATEA_STOP_EXPECTED_ONE_ARMED_ROW_NO_GO';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.novelight_ai_runtime_settings
     WHERE singleton = 1 AND enabled IS FALSE
       AND user_day_cap_micros = 0 AND user_month_cap_micros = 0
       AND global_day_cap_micros = 0 AND global_month_cap_micros = 0
  ) THEN
    RAISE EXCEPTION 'GATEA_STOP_VERIFY_NO_GO';
  END IF;
END
$function$;
COMMIT;
*/
