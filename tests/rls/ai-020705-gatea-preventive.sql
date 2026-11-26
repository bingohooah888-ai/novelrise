-- Runs only in the existing disposable CI PG, after the existing CAS proof.
-- Entire added fixture, roles and proposal are rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'novelight_ai_020705_claim_disposable'
     OR session_user <> 'postgres' THEN RAISE EXCEPTION 'GATEA_DISPOSABLE_ONLY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='novelight_gatea_stop') THEN
    CREATE ROLE novelight_gatea_stop NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='novelight_gatea_census') THEN
    CREATE ROLE novelight_gatea_census NOLOGIN NOINHERIT;
  END IF;
END $guard$;
GRANT service_role TO authenticator;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE);
CREATE TABLE auth.identities(id bigint PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE);
CREATE TABLE auth.refresh_tokens(id bigint PRIMARY KEY,user_id text,session_id uuid REFERENCES auth.sessions ON DELETE CASCADE);
CREATE TABLE storage.objects(id bigint PRIMARY KEY,owner uuid,owner_id text);
INSERT INTO auth.users VALUES
 ('11111111-1111-4111-8111-111111111111','not-a-synthetic@example.invalid','{}'),
 ('33333333-3333-4333-8333-333333333333','novelight-ai-020705-disposable@example.invalid','{"internal_e2e":true}');
ALTER TABLE public.novels ADD FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.episodes ADD COLUMN user_id uuid REFERENCES auth.users(id);
UPDATE public.episodes e SET user_id=n.user_id FROM public.novels n WHERE n.id=e.novel_id;
ALTER TABLE public.episodes DROP CONSTRAINT episodes_novel_id_fkey;
ALTER TABLE public.episodes ADD FOREIGN KEY(novel_id) REFERENCES public.novels ON DELETE CASCADE;
ALTER TABLE public.novelight_ai_episode_analysis DROP CONSTRAINT novelight_ai_episode_analysis_episode_id_fkey;
ALTER TABLE public.novelight_ai_episode_analysis ADD FOREIGN KEY(episode_id) REFERENCES public.episodes ON DELETE CASCADE;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE);
CREATE TABLE public.novelight_ai_bible_facts(novel_id bigint REFERENCES public.novels ON DELETE CASCADE,source_episode_id bigint REFERENCES public.episodes ON DELETE CASCADE);
CREATE TABLE public.novelight_ai_review_candidates(actor_id uuid,novel_id bigint REFERENCES public.novels ON DELETE CASCADE,source_episode_id bigint REFERENCES public.episodes ON DELETE CASCADE);
CREATE TABLE public.novelight_ai_external_processing_consents(actor_id uuid,novel_id bigint REFERENCES public.novels ON DELETE CASCADE);
CREATE TABLE public.novelight_ai_external_consent_action_audit(actor_id uuid,novel_id bigint REFERENCES public.novels ON DELETE CASCADE);
CREATE TABLE public.novelight_ai_usage_requests(actor_id uuid REFERENCES auth.users ON DELETE CASCADE,work_id bigint REFERENCES public.novels ON DELETE SET NULL);
CREATE TABLE public.novelight_ai_usage_audit(actor_id uuid REFERENCES auth.users ON DELETE SET NULL,work_id bigint REFERENCES public.novels ON DELETE SET NULL);
CREATE TABLE public.novelight_ai_runtime_settings(singleton integer PRIMARY KEY,enabled boolean NOT NULL,user_day_cap_micros bigint NOT NULL,user_month_cap_micros bigint NOT NULL,global_day_cap_micros bigint NOT NULL,global_month_cap_micros bigint NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE public.novelight_ai_020705_one_shot_claims(
 approval_comment_id bigint PRIMARY KEY CHECK(approval_comment_id>0),actor_id uuid NOT NULL,
 novel_id bigint NOT NULL,episode_id bigint NOT NULL,main_sha text NOT NULL,
 preview_deployment_id text NOT NULL,provider text NOT NULL CHECK(provider='openai'),
 model text NOT NULL CHECK(model='gpt-5.6-luna'),
 ceiling_micros bigint NOT NULL CHECK(ceiling_micros BETWEEN 1 AND 10000000),
 consumed_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 UNIQUE(main_sha,preview_deployment_id,actor_id,novel_id,episode_id),
 CHECK(expires_at>consumed_at AND expires_at<=consumed_at+interval '1 hour')
);
GRANT ALL ON public.novelight_ai_020705_one_shot_claims TO service_role;
INSERT INTO public.novelight_ai_020705_one_shot_claims VALUES
 (1,'11111111-1111-4111-8111-111111111111',41,11,repeat('a',40),'dpl_historical','openai','gpt-5.6-luna',100,now()-interval '2 hours',now()-interval '90 minutes');
INSERT INTO public.novelight_ai_runtime_settings VALUES(1,true,100,100,100,100,now());
INSERT INTO public.novels VALUES(42,'33333333-3333-4333-8333-333333333333');
INSERT INTO public.episodes(id,novel_id,title,content,user_id) VALUES(12,42,'mock','mock','33333333-3333-4333-8333-333333333333');
INSERT INTO auth.sessions VALUES('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333');
INSERT INTO auth.identities VALUES(1,'33333333-3333-4333-8333-333333333333');
INSERT INTO auth.refresh_tokens VALUES(1,'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
INSERT INTO public.profiles VALUES('33333333-3333-4333-8333-333333333333');
INSERT INTO public.novelight_ai_bible_facts VALUES(42,12);
INSERT INTO public.novelight_ai_review_candidates VALUES('33333333-3333-4333-8333-333333333333',42,12);
INSERT INTO public.novelight_ai_external_processing_consents VALUES('33333333-3333-4333-8333-333333333333',42);
INSERT INTO public.novelight_ai_external_consent_action_audit VALUES('33333333-3333-4333-8333-333333333333',42);
INSERT INTO public.novelight_ai_usage_requests VALUES('33333333-3333-4333-8333-333333333333',42);
INSERT INTO public.novelight_ai_usage_audit VALUES('33333333-3333-4333-8333-333333333333',42);
\ir ../../reports/sql/novelight_ai_gatea_preventive_v1_PROPOSAL.sql

-- Effective privileges, not just an expected GRANT statement.
DO $proof$ BEGIN
 IF has_table_privilege('service_role','public.novelight_ai_020705_one_shot_claims','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_any_column_privilege('service_role','public.novelight_ai_020705_one_shot_claims','INSERT,UPDATE')
    OR has_table_privilege('service_role','gatea_stop_private.trial_scope','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_function_privilege('novelight_gatea_stop','public.novelight_gatea_census_v1()','EXECUTE')
    OR has_function_privilege('novelight_gatea_census','public.novelight_gatea_stop_v1()','EXECUTE')
    OR has_table_privilege('novelight_gatea_census','auth.refresh_tokens','SELECT')
    OR has_function_privilege('service_role','gatea_stop_private.cleanup_due()','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('novelight_gatea_stop','novelight_gatea_census') AND rolcanlogin)
 THEN RAISE EXCEPTION 'GATEA_PRIVILEGE_ISOLATION_FAILED'; END IF;
END $proof$;
SELECT (clock_timestamp()+interval '10 minutes') AS expiry \gset
SET SESSION AUTHORIZATION authenticator;
SET ROLE service_role;
SELECT NOT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_newMock','openai','gpt-6.1-sol',100,:'expiry','wmlzjgvxgoyrovdhbqbg') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
RESET SESSION AUTHORIZATION;
INSERT INTO gatea_stop_private.trial_scope(singleton,approval_comment_id,actor_id,novel_id,episode_id,claim_sha,preview_id,ceiling_micros,expires_at)
 VALUES(1,2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_newMock',100,:'expiry');
SET SESSION AUTHORIZATION authenticator;
SET ROLE service_role;
SELECT NOT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_HscqVwRoSCxBAt9C3LHLof5971L9','openai','gpt-6.1-sol',100,:'expiry','wmlzjgvxgoyrovdhbqbg')
 AND NOT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_251t6K9U4ntcDtvE4HbLPxXbSAKE','openai','gpt-6.1-sol',100,:'expiry','wmlzjgvxgoyrovdhbqbg')
 AND NOT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_newMock','openai','gpt-5.6-luna',100,:'expiry','wmlzjgvxgoyrovdhbqbg') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SELECT public.novelight_ai_owner_session_exists_v1('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SELECT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_newMock','openai','gpt-6.1-sol',100,:'expiry','wmlzjgvxgoyrovdhbqbg') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SELECT NOT public.novelight_ai_020705_claim_once(2,'33333333-3333-4333-8333-333333333333',42,12,repeat('b',40),'dpl_newMock','openai','gpt-6.1-sol',100,:'expiry','wmlzjgvxgoyrovdhbqbg') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- An unclaimed, expired scope must deny before cron/STOP runs.
UPDATE gatea_stop_private.trial_scope SET approval_comment_id=3,claim_sha=repeat('c',40),
 created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute';
SELECT expires_at AS past_expiry FROM gatea_stop_private.trial_scope \gset
SET SESSION AUTHORIZATION authenticator;
SET ROLE service_role;
SELECT NOT public.novelight_ai_020705_claim_once(3,'33333333-3333-4333-8333-333333333333',42,12,repeat('c',40),'dpl_newMock','openai','gpt-6.1-sol',100,:'past_expiry','wmlzjgvxgoyrovdhbqbg') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE gatea_stop_private.trial_scope SET approval_comment_id=2,claim_sha=repeat('b',40),
 created_at=clock_timestamp(),expires_at=:'expiry';
SET SESSION AUTHORIZATION authenticator;
SET ROLE novelight_gatea_census;
SELECT (public.novelight_gatea_census_v1()->>'users')::int=1 AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
SET ROLE novelight_gatea_stop;
SELECT public.novelight_gatea_stop_v1() AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SELECT public.novelight_gatea_stop_v1() AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
SET ROLE service_role;
SELECT NOT public.novelight_ai_owner_session_exists_v1('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444') AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- Simulate cron time; no wall-clock sleep or hosted cron registration.
UPDATE gatea_stop_private.trial_scope SET revoked_at=clock_timestamp()-interval '3 minutes';
SELECT gatea_stop_private.expire_stop_due();
-- Real user's cross-scope audit must not be removed.
INSERT INTO public.novelight_ai_usage_audit VALUES('11111111-1111-4111-8111-111111111111',42);
DO $cross$ BEGIN
  BEGIN
    PERFORM gatea_stop_private.cleanup_due();
    RAISE EXCEPTION 'GATEA_CROSS_SCOPE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'GATEA_CROSS_SCOPE_NO_GO' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='33333333-3333-4333-8333-333333333333')
     OR NOT EXISTS (SELECT 1 FROM public.novelight_ai_usage_audit WHERE actor_id='11111111-1111-4111-8111-111111111111' AND work_id=42)
  THEN RAISE EXCEPTION 'GATEA_CROSS_SCOPE_MUTATED'; END IF;
END $cross$;
DELETE FROM public.novelight_ai_usage_audit WHERE actor_id='11111111-1111-4111-8111-111111111111' AND work_id=42;
SELECT gatea_stop_private.cleanup_due() AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SELECT NOT gatea_stop_private.cleanup_due() AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
SET SESSION AUTHORIZATION authenticator;
SET ROLE novelight_gatea_census;
SELECT public.novelight_gatea_census_v1() AS report \gset
SELECT (:'report'::jsonb->>'runtimeDisabledZero')::boolean
 AND (:'report'::jsonb->>'approvalTombstoneCount')::int=1
 AND (:'report'::jsonb->>'chunkClaimsRetained')::int=0
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(:'report'::jsonb) AS item(k,v)
   WHERE k IN ('users','identities','sessions','profiles','novels','episodes','facts','analysis','reviewCandidates','consents','consentAudit','usageRequests','usageAudit','refreshTokens','storageObjects')
   AND v IS DISTINCT FROM '0'::jsonb) AS ok \gset
\if :ok
\else
 SELECT 1/0;
\endif
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $proof$ BEGIN
  IF (SELECT count(*) FROM public.novelight_ai_020705_one_shot_claims)<>2
     OR (SELECT count(*) FROM public.novelight_ai_chunk_claims)<>1
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111')
  THEN RAISE EXCEPTION 'GATEA_TOMBSTONE_OR_UNRELATED_DATA_CHANGED'; END IF;
  BEGIN
    INSERT INTO public.novelight_ai_usage_audit VALUES('33333333-3333-4333-8333-333333333333',42);
    RAISE EXCEPTION 'GATEA_LATE_WRITE_NOT_FENCED';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $proof$;
-- A non-synthetic owner must never be deleted even with a forged test scope.
UPDATE gatea_stop_private.trial_scope SET actor_id='11111111-1111-4111-8111-111111111111',novel_id=41,episode_id=11;
DO $real$ BEGIN
  BEGIN
    PERFORM gatea_stop_private.cleanup_due();
    RAISE EXCEPTION 'GATEA_REAL_USER_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'GATEA_SYNTHETIC_SCOPE_NO_GO' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111')
  THEN RAISE EXCEPTION 'GATEA_REAL_USER_DELETED'; END IF;
END $real$;
ROLLBACK;
\echo 'PASS: preventive scope, old deployment deny, claim ACL, STOP/census roles, simulated expiry cleanup and retained tombstones on disposable PostgreSQL'
