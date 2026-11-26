-- OFFLINE PROPOSAL ONLY. Existing Gate A disposable CI PostgreSQL, not a migration.
-- No hosted database, deployment, credentials, paid requests, or new service.
-- Live activation requires a separately reviewed Staging-only apply, actual
-- Data API role/JWT isolation, no raw provider-key bypass, and crash drills.
-- The existing Preview remains available for UNPAID verification only.
-- Preserve historical claim tombstones and existing Cloudflare SQLite.
DO $guard$
BEGIN
  IF current_database() <> 'novelight_ai_020705_claim_disposable'
     OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'GATEA_OFFLINE_DISPOSABLE_ONLY';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS gatea_stop_private;
REVOKE ALL ON SCHEMA gatea_stop_private FROM PUBLIC;
-- One owner-managed, immutable-to-runtime scope; no public arm endpoint.
-- Register the exact pre-provisioned synthetic fixture before the trial starts.
CREATE TABLE gatea_stop_private.trial_scope (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  approval_comment_id bigint NOT NULL CHECK (approval_comment_id > 0),
  actor_id uuid NOT NULL,
  novel_id bigint NOT NULL CHECK (novel_id > 0),
  episode_id bigint NOT NULL CHECK (episode_id > 0),
  claim_sha text NOT NULL CHECK (claim_sha ~ '^[a-f0-9]{40}$'),
  preview_id text NOT NULL CHECK (preview_id ~ '^dpl_[A-Za-z0-9]+$'
    AND preview_id NOT IN ('dpl_HscqVwRoSCxBAt9C3LHLof5971L9',
      'dpl_251t6K9U4ntcDtvE4HbLPxXbSAKE')),
  ceiling_micros bigint NOT NULL CHECK (ceiling_micros BETWEEN 1 AND 10000000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
REVOKE ALL ON gatea_stop_private.trial_scope FROM PUBLIC, anon, authenticated, service_role;

-- Preserve historical model values, but admit only the current reviewed model.
-- Staging's existing model CHECK and RPC still pin gpt-5.6-luna.
DO $model$
DECLARE name text; n integer;
BEGIN
  SELECT count(*), min(c.conname::text) INTO n, name FROM pg_constraint c
  WHERE c.conrelid = 'public.novelight_ai_020705_one_shot_claims'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) = 'CHECK ((model = ''gpt-5.6-luna''::text))';
  IF n <> 1 THEN RAISE EXCEPTION 'GATEA_MODEL_CONSTRAINT_NO_GO'; END IF;
  EXECUTE format('ALTER TABLE public.novelight_ai_020705_one_shot_claims DROP CONSTRAINT %I', name);
END
$model$;
ALTER TABLE public.novelight_ai_020705_one_shot_claims
  ADD CONSTRAINT gatea_historical_model_check
  CHECK (model IN ('gpt-5.6-luna', 'gpt-6.1-sol'));
-- The live ACL currently grants ALL to service_role. No direct mutation of
-- durable tombstones, including TRUNCATE or direct INSERT, is permitted.
REVOKE ALL ON public.novelight_ai_020705_one_shot_claims
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.novelight_ai_020705_one_shot_claims TO service_role;

-- Reuse the existing atomic INSERT ... ON CONFLICT DO NOTHING and signature.
-- Private definer owns the INSERT; public RPC remains SECURITY INVOKER.
-- The role GUC is checked alongside authenticator session identity, not an
-- untrusted request JSON field. Live PostgREST behavior is still to be proven.
CREATE FUNCTION gatea_stop_private.claim_once(
  p_approval_comment_id bigint, p_actor_id uuid, p_novel_id bigint,
  p_episode_id bigint, p_main_sha text, p_preview_deployment_id text,
  p_provider text, p_model text, p_ceiling_micros bigint,
  p_expires_at timestamptz, p_project_ref text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $claim$
DECLARE
  s gatea_stop_private.trial_scope%ROWTYPE;
  r public.novelight_ai_runtime_settings%ROWTYPE;
  consumed bigint;
  sent_at timestamptz;
BEGIN
  IF session_user <> 'authenticator'
     OR current_setting('role', true) IS DISTINCT FROM 'service_role'
     OR p_project_ref IS DISTINCT FROM 'wmlzjgvxgoyrovdhbqbg' THEN
    RAISE EXCEPTION 'GATEA_CLAIM_CALLER_NO_GO' USING ERRCODE = '42501';
  END IF;
  IF p_provider IS DISTINCT FROM 'openai'
     OR p_model IS DISTINCT FROM 'gpt-6.1-sol'
     OR p_ceiling_micros IS NULL OR p_ceiling_micros NOT BETWEEN 1 AND 10000000
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '1 hour' THEN
    RETURN false;
  END IF;
  -- STOP and admission serialize on this same owner-managed row.
  SELECT * INTO s FROM gatea_stop_private.trial_scope WHERE singleton = 1 FOR SHARE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at <= clock_timestamp()
     OR ROW(p_approval_comment_id,p_actor_id,p_novel_id,p_episode_id,p_main_sha,
            p_preview_deployment_id,p_ceiling_micros,p_expires_at)
        IS DISTINCT FROM ROW(s.approval_comment_id,s.actor_id,s.novel_id,s.episode_id,
            s.claim_sha,s.preview_id,s.ceiling_micros,s.expires_at) THEN
    RETURN false;
  END IF;
  SELECT * INTO r FROM public.novelight_ai_runtime_settings WHERE singleton = 1 FOR SHARE;
  IF NOT FOUND OR r.enabled IS NOT TRUE
     OR r.user_day_cap_micros NOT BETWEEN p_ceiling_micros AND 10000000
     OR r.user_month_cap_micros NOT BETWEEN p_ceiling_micros AND 10000000
     OR r.global_day_cap_micros NOT BETWEEN p_ceiling_micros AND 10000000
     OR r.global_month_cap_micros NOT BETWEEN p_ceiling_micros AND 10000000
     OR r.user_day_cap_micros IS NULL OR r.user_month_cap_micros IS NULL
     OR r.global_day_cap_micros IS NULL OR r.global_month_cap_micros IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.novels n JOIN public.episodes e ON e.novel_id = n.id
       JOIN auth.users u ON u.id = n.user_id
       WHERE n.id = s.novel_id AND e.id = s.episode_id AND n.user_id = s.actor_id
         AND e.user_id = s.actor_id
         AND u.raw_app_meta_data->'internal_e2e' = 'true'::jsonb
         AND left(u.email,length('novelight-ai-020705-')) = 'novelight-ai-020705-'
     ) THEN RETURN false;
  END IF;
  sent_at := clock_timestamp();
  IF sent_at >= s.expires_at THEN RETURN false; END IF;
  INSERT INTO public.novelight_ai_020705_one_shot_claims (
    approval_comment_id,actor_id,novel_id,episode_id,main_sha,preview_deployment_id,
    provider,model,ceiling_micros,consumed_at,expires_at
  ) VALUES (p_approval_comment_id,p_actor_id,p_novel_id,p_episode_id,p_main_sha,
    p_preview_deployment_id,p_provider,p_model,p_ceiling_micros,sent_at,p_expires_at)
  ON CONFLICT DO NOTHING RETURNING approval_comment_id INTO consumed;
  -- A spent claim is retained even if expiry occurs during a blocked INSERT.
  RETURN consumed IS NOT NULL AND clock_timestamp() < s.expires_at;
END
$claim$;

CREATE OR REPLACE FUNCTION public.novelight_ai_020705_claim_once(
  p_approval_comment_id bigint, p_actor_id uuid, p_novel_id bigint,
  p_episode_id bigint, p_main_sha text, p_preview_deployment_id text,
  p_provider text, p_model text, p_ceiling_micros bigint,
  p_expires_at timestamptz, p_project_ref text
) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $public_claim$
  SELECT gatea_stop_private.claim_once($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
$public_claim$;
REVOKE ALL ON FUNCTION gatea_stop_private.claim_once(bigint,uuid,bigint,bigint,text,text,text,text,bigint,timestamptz,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.novelight_ai_020705_claim_once(bigint,uuid,bigint,bigint,text,text,text,text,bigint,timestamptz,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA gatea_stop_private TO service_role;
GRANT EXECUTE ON FUNCTION gatea_stop_private.claim_once(bigint,uuid,bigint,bigint,text,text,text,text,bigint,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.novelight_ai_020705_claim_once(bigint,uuid,bigint,bigint,text,text,text,text,bigint,timestamptz,text) TO service_role;

-- Separate Data API roles; NOLOGIN removes the direct SQL/PUBLIC-net route.
-- No credential is issued here. Exposed schema and API-wide deny proof remain
-- mandatory; NOLOGIN alone is NOT proof of Data API least privilege.
ALTER ROLE novelight_gatea_stop NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE novelight_gatea_census NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT novelight_gatea_stop, novelight_gatea_census TO authenticator;
GRANT USAGE ON SCHEMA public, gatea_stop_private TO novelight_gatea_stop, novelight_gatea_census;
REVOKE ALL ON gatea_stop_private.trial_scope FROM novelight_gatea_stop, novelight_gatea_census;

-- Reuse existing STOP RPC and make it idempotent, including already-OFF state.
CREATE OR REPLACE FUNCTION gatea_stop_private.stop_once() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $stop$
DECLARE affected integer;
BEGIN
  IF (session_user = 'postgres' OR
     (session_user = 'authenticator' AND current_setting('role',true) = 'novelight_gatea_stop')) IS NOT TRUE
  THEN RAISE EXCEPTION 'GATEA_STOP_CALLER_NO_GO' USING ERRCODE = '42501'; END IF;
  UPDATE gatea_stop_private.trial_scope
    SET revoked_at = coalesce(revoked_at,clock_timestamp()) WHERE singleton=1;
  UPDATE public.novelight_ai_runtime_settings SET enabled=false,
    user_day_cap_micros=0,user_month_cap_micros=0,global_day_cap_micros=0,
    global_month_cap_micros=0,updated_at=clock_timestamp() WHERE singleton=1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 OR NOT EXISTS (SELECT 1 FROM public.novelight_ai_runtime_settings
    WHERE singleton=1 AND enabled IS FALSE AND user_day_cap_micros=0
      AND user_month_cap_micros=0 AND global_day_cap_micros=0 AND global_month_cap_micros=0)
  THEN RAISE EXCEPTION 'GATEA_STOP_VERIFY_NO_GO'; END IF;
END
$stop$;
-- Preserve the existing void STOP signature. Return only the actual runtime
-- row, never a fabricated success object; the independent census is separate.
CREATE FUNCTION gatea_stop_private.stop_with_readback() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $stop_readback$
DECLARE result jsonb;
BEGIN
  IF session_user <> 'authenticator' OR current_setting('role',true)
       IS DISTINCT FROM 'novelight_gatea_stop' THEN
    RAISE EXCEPTION 'GATEA_STOP_CALLER_NO_GO' USING ERRCODE='42501';
  END IF;
  PERFORM gatea_stop_private.stop_once();
  SELECT jsonb_build_object('count',1,'data',jsonb_build_object(
    'singleton',singleton,'enabled',enabled,
    'user_day_cap_micros',user_day_cap_micros,'user_month_cap_micros',user_month_cap_micros,
    'global_day_cap_micros',global_day_cap_micros,'global_month_cap_micros',global_month_cap_micros))
  INTO STRICT result FROM public.novelight_ai_runtime_settings WHERE singleton=1;
  RETURN result;
END
$stop_readback$;
CREATE FUNCTION public.novelight_gatea_stop_v1() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $stop_api$
  SELECT gatea_stop_private.stop_with_readback();
$stop_api$;
REVOKE ALL ON FUNCTION gatea_stop_private.stop_once(),gatea_stop_private.stop_with_readback(),
  public.novelight_gatea_stop_v1()
  FROM PUBLIC,anon,authenticated,service_role,novelight_gatea_census;
GRANT EXECUTE ON FUNCTION gatea_stop_private.stop_with_readback(),public.novelight_gatea_stop_v1()
  TO novelight_gatea_stop;

-- The exact existing 16-table census is reused, with owner-pinned scope and
-- no caller-supplied SQL or identifiers. Only counts/echoes are returned.
CREATE FUNCTION gatea_stop_private.census() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $census$
DECLARE s gatea_stop_private.trial_scope%ROWTYPE; result jsonb;
BEGIN
  IF session_user <> 'authenticator' OR current_setting('role',true)
       IS DISTINCT FROM 'novelight_gatea_census' THEN
    RAISE EXCEPTION 'GATEA_CENSUS_CALLER_NO_GO' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT s FROM gatea_stop_private.trial_scope WHERE singleton=1;
  SELECT to_jsonb(census) || jsonb_build_object(
    'scopeActor',s.actor_id::text,'scopeNovel',s.novel_id::text,
    'scopeApproval',s.approval_comment_id::text,'scopeEpisode',s.episode_id::text,
    'scopeMain',s.claim_sha,'scopePreview',s.preview_id,
    'refreshTokens',(SELECT count(*) FROM auth.refresh_tokens t WHERE t.user_id::text=s.actor_id::text),
    'storageObjects',(SELECT count(*) FROM storage.objects o
       WHERE o.owner_id::text=s.actor_id::text OR o.owner::text=s.actor_id::text)
  ) INTO result FROM (SELECT
 (select pg_catalog.count(*)::int from auth.users where id=s.actor_id) as "users",
 (select pg_catalog.count(*)::int from auth.identities where user_id=s.actor_id) as "identities",
 (select pg_catalog.count(*)::int from auth.sessions where user_id=s.actor_id) as "sessions",
 (select pg_catalog.count(*)::int from public.profiles where id=s.actor_id) as "profiles",
 (select pg_catalog.count(*)::int from public.novels where user_id=s.actor_id or id=s.novel_id) as "novels",
 (select pg_catalog.count(*)::int from public.episodes where user_id=s.actor_id or novel_id=s.novel_id or id=s.episode_id) as "episodes",
 (select pg_catalog.count(*)::int from public.novelight_ai_bible_facts where novel_id=s.novel_id or source_episode_id=s.episode_id) as "facts",
 (select pg_catalog.count(*)::int from public.novelight_ai_episode_analysis a where episode_id=s.episode_id or exists
   (select 1 from public.episodes e where e.id=a.episode_id and (e.novel_id=s.novel_id or e.user_id=s.actor_id))) as "analysis",
 (select pg_catalog.count(*)::int from public.novelight_ai_review_candidates where actor_id=s.actor_id or novel_id=s.novel_id or source_episode_id=s.episode_id) as "reviewCandidates",
 (select pg_catalog.count(*)::int from public.novelight_ai_external_processing_consents where actor_id=s.actor_id or novel_id=s.novel_id) as "consents",
 (select pg_catalog.count(*)::int from public.novelight_ai_external_consent_action_audit where actor_id=s.actor_id or novel_id=s.novel_id) as "consentAudit",
 (select pg_catalog.count(*)::int from public.novelight_ai_usage_requests where actor_id=s.actor_id or work_id=s.novel_id) as "usageRequests",
 (select pg_catalog.count(*)::int from public.novelight_ai_usage_audit where actor_id=s.actor_id or work_id=s.novel_id) as "usageAudit",
 (select pg_catalog.count(*)=1 from public.novelight_ai_runtime_settings where singleton=1 and enabled=false
   and user_day_cap_micros=0 and user_month_cap_micros=0 and global_day_cap_micros=0 and global_month_cap_micros=0) as "runtimeDisabledZero",
 (select pg_catalog.count(*)::int from public.novelight_ai_020705_one_shot_claims where approval_comment_id=s.approval_comment_id
   and actor_id=s.actor_id and novel_id=s.novel_id and episode_id=s.episode_id
   and main_sha=s.claim_sha and preview_deployment_id=s.preview_id) as "approvalTombstoneCount",
 (select pg_catalog.count(*)::int from public.novelight_ai_chunk_claims where actor_id=s.actor_id or novel_id=s.novel_id) as "chunkClaimsRetained"
  ) AS census;
  -- No self-certified readOnlyVerified boolean.
  RETURN result;
END
$census$;
CREATE FUNCTION public.novelight_gatea_census_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $census_api$
  SELECT gatea_stop_private.census();
$census_api$;
REVOKE ALL ON FUNCTION gatea_stop_private.census(),public.novelight_gatea_census_v1()
  FROM PUBLIC,anon,authenticated,service_role,novelight_gatea_stop;
GRANT EXECUTE ON FUNCTION gatea_stop_private.census(),public.novelight_gatea_census_v1()
  TO novelight_gatea_census;

-- Existing session-exists interface, scoped to the synthetic actor only.
-- Physical session existence is independent of admission expiry/revocation.
-- Never use an admission-denied result as evidence that a session was deleted.
-- Claim rejects a revoked scope even while a physical session still exists.
CREATE FUNCTION gatea_stop_private.session_exists(p_actor_id uuid,p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $session$
BEGIN
  IF session_user <> 'authenticator' OR current_setting('role',true)
       IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'GATEA_SESSION_CALLER_NO_GO' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM gatea_stop_private.trial_scope s
    JOIN auth.sessions a ON a.user_id=s.actor_id JOIN auth.users u ON u.id=a.user_id
    WHERE s.singleton=1 AND s.actor_id=p_actor_id AND a.id=p_session_id
      AND u.raw_app_meta_data->'internal_e2e'='true'::jsonb
      AND left(u.email,length('novelight-ai-020705-'))='novelight-ai-020705-');
END
$session$;
CREATE FUNCTION public.novelight_ai_owner_session_exists_v1(p_actor_id uuid,p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $session_api$
  SELECT gatea_stop_private.session_exists($1,$2);
$session_api$;
REVOKE ALL ON FUNCTION gatea_stop_private.session_exists(uuid,uuid),
  public.novelight_ai_owner_session_exists_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated,novelight_gatea_stop,novelight_gatea_census;
GRANT EXECUTE ON FUNCTION gatea_stop_private.session_exists(uuid,uuid),
  public.novelight_ai_owner_session_exists_v1(uuid,uuid) TO service_role;

-- Existing pg_cron owner (postgres) only. Two separate transactions/jobs:
-- STOP must commit even if cleanup fails. Expiry in claim is authoritative
-- even if cron is delayed. Scheduling and hosted Auth behavior are unproven.
CREATE FUNCTION gatea_stop_private.expire_stop_due() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $expire$
BEGIN
  IF session_user <> 'postgres' THEN RAISE EXCEPTION 'GATEA_CRON_CALLER_NO_GO' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM gatea_stop_private.trial_scope WHERE singleton=1
       AND (revoked_at IS NOT NULL OR expires_at<=clock_timestamp())) THEN
    PERFORM gatea_stop_private.stop_once();
  END IF;
END
$expire$;

CREATE FUNCTION gatea_stop_private.cleanup_due() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $cleanup$
DECLARE s gatea_stop_private.trial_scope%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
  IF session_user <> 'postgres' THEN RAISE EXCEPTION 'GATEA_CRON_CALLER_NO_GO' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM gatea_stop_private.trial_scope WHERE singleton=1 FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NULL OR s.revoked_at + interval '2 minutes' > clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM public.novelight_ai_runtime_settings
       WHERE singleton=1 AND enabled IS FALSE AND user_day_cap_micros=0
         AND user_month_cap_micros=0 AND global_day_cap_micros=0 AND global_month_cap_micros=0)
  THEN RETURN false; END IF;
  PERFORM 1 FROM public.novelight_ai_runtime_settings WHERE singleton=1
    AND enabled IS FALSE AND user_day_cap_micros=0 AND user_month_cap_micros=0
    AND global_day_cap_micros=0 AND global_month_cap_micros=0 FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Grace period is not provider cancellation or evidence of quiescence.
  -- Lock parents before deleting usage so FK-bound late inserts cannot race
  -- past the parent deletion. Hosted Auth/Storage and other write paths still
  -- require a separate negative drill.
  SELECT * INTO u FROM auth.users WHERE id=s.actor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF; -- independent census decides zero
  IF u.raw_app_meta_data->'internal_e2e' IS DISTINCT FROM 'true'::jsonb
     OR left(u.email,length('novelight-ai-020705-')) IS DISTINCT FROM 'novelight-ai-020705-'
     OR EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner_id::text=s.actor_id::text OR o.owner::text=s.actor_id::text)
  THEN RAISE EXCEPTION 'GATEA_SYNTHETIC_SCOPE_NO_GO'; END IF;
  PERFORM 1 FROM public.novels WHERE id=s.novel_id FOR UPDATE;
  PERFORM 1 FROM public.episodes WHERE novel_id=s.novel_id OR id=s.episode_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.novels WHERE (id=s.novel_id AND user_id IS DISTINCT FROM s.actor_id)
       OR (user_id=s.actor_id AND id<>s.novel_id))
     OR EXISTS (SELECT 1 FROM public.episodes WHERE (id=s.episode_id AND novel_id<>s.novel_id)
       OR (novel_id=s.novel_id AND user_id IS DISTINCT FROM s.actor_id)
       OR (user_id=s.actor_id AND novel_id<>s.novel_id))
  THEN RAISE EXCEPTION 'GATEA_SYNTHETIC_OWNERSHIP_NO_GO'; END IF;
  -- Cross-actor or cross-work records are not authorized synthetic fixtures.
  -- Fail closed instead of deleting a real user's audit or consent data.
  IF EXISTS (SELECT 1 FROM public.novelight_ai_usage_audit
       WHERE (actor_id=s.actor_id OR work_id=s.novel_id)
       AND ((actor_id IS NOT NULL AND actor_id<>s.actor_id) OR
            (work_id IS NOT NULL AND work_id<>s.novel_id)))
     OR EXISTS (SELECT 1 FROM public.novelight_ai_usage_requests
       WHERE (actor_id=s.actor_id OR work_id=s.novel_id)
       AND ((actor_id IS NOT NULL AND actor_id<>s.actor_id) OR
            (work_id IS NOT NULL AND work_id<>s.novel_id)))
     OR EXISTS (SELECT 1 FROM public.novelight_ai_review_candidates
       WHERE (actor_id=s.actor_id OR novel_id=s.novel_id OR source_episode_id=s.episode_id)
       AND (actor_id IS DISTINCT FROM s.actor_id OR novel_id IS DISTINCT FROM s.novel_id))
     OR EXISTS (SELECT 1 FROM public.novelight_ai_external_processing_consents
       WHERE (actor_id=s.actor_id OR novel_id=s.novel_id)
       AND (actor_id IS DISTINCT FROM s.actor_id OR novel_id IS DISTINCT FROM s.novel_id))
     OR EXISTS (SELECT 1 FROM public.novelight_ai_external_consent_action_audit
       WHERE (actor_id=s.actor_id OR novel_id=s.novel_id)
       AND (actor_id IS DISTINCT FROM s.actor_id OR novel_id IS DISTINCT FROM s.novel_id))
  THEN RAISE EXCEPTION 'GATEA_CROSS_SCOPE_NO_GO'; END IF;
  -- Reuse the existing cleanup order: scoped usage, novel cascades, Auth.
  -- Never delete either claim ledger. Never delete arbitrary real users.
  DELETE FROM auth.sessions WHERE user_id=s.actor_id;
  DELETE FROM public.novelight_ai_usage_audit WHERE actor_id=s.actor_id OR work_id=s.novel_id;
  DELETE FROM public.novelight_ai_usage_requests WHERE actor_id=s.actor_id OR work_id=s.novel_id;
  DELETE FROM public.novels WHERE id=s.novel_id AND user_id=s.actor_id;
  DELETE FROM auth.users WHERE id=s.actor_id;
  RETURN true; -- independent fixed-scope census is the deletion evidence
END
$cleanup$;
REVOKE ALL ON FUNCTION gatea_stop_private.expire_stop_due(),gatea_stop_private.cleanup_due()
  FROM PUBLIC,anon,authenticated,service_role,novelight_gatea_stop,novelight_gatea_census;

-- Proposed separately approved Staging scheduling, NOT executed in this file:
-- SELECT cron.schedule('novelight-gatea-expire-stop-v1','* * * * *',
--   'SELECT gatea_stop_private.expire_stop_due()');
-- SELECT cron.schedule('novelight-gatea-cleanup-v1','* * * * *',
--   'SELECT gatea_stop_private.cleanup_due()');
-- Before activation: verify exact exposed Data API schemas, no other RPC/table
-- access for either role, no direct logins/other role memberships, independent
-- JWT issuance and signature validation, old provider-key paths, and late
-- writes/actual hosted Auth deletion. A mock PASS is not a live Gate A PASS.
