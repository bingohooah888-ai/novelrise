\set ON_ERROR_STOP on
-- HIGH-RISK RESTORE SCRIPT: DO NOT AUTO-RUN ON HOSTED SUPABASE.
-- Fail closed if any real user community activity or public opt-in exists.
-- In a live incident prefer disabling the app feature flag first.
BEGIN;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.community_runtime_control WHERE public_enabled)
 OR EXISTS(SELECT 1 FROM public.community_reactions LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_comments LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_reports LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_hidden_posts LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_user_restrictions LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_notifications LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.community_seed_shares LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.author_notes WHERE show_in_timeline)
 OR EXISTS(SELECT 1 FROM public.reader_curation_lists WHERE community_share_enabled)
 THEN RAISE EXCEPTION 'Community contains user data/consents. Destructive rollback prohibited.';
 END IF;
END
$guard$;
DROP TRIGGER IF EXISTS community_author_note_consent_guard ON public.author_notes;
DROP TRIGGER IF EXISTS community_curation_visibility_guard ON public.reader_curation_lists;

DROP FUNCTION IF EXISTS public.novelight_admin_community_metrics(integer);
DROP FUNCTION IF EXISTS public.novelight_set_my_seed_community_share(uuid,boolean);
DROP FUNCTION IF EXISTS public.novelight_my_seed_community_shares();
DROP FUNCTION IF EXISTS public.novelight_set_my_curation_community_share(bigint,boolean);
DROP FUNCTION IF EXISTS public.novelight_manage_my_curation_lists_v2();
DROP FUNCTION IF EXISTS public.novelight_admin_community_moderate(uuid,text,text,uuid,text);
DROP FUNCTION IF EXISTS public.novelight_community_mark_notifications_read(bigint[]);
DROP FUNCTION IF EXISTS public.novelight_community_my_notifications(integer);
DROP FUNCTION IF EXISTS public.novelight_community_post_author(text);
DROP FUNCTION IF EXISTS public.novelight_manage_my_author_notes_v2(integer);
DROP FUNCTION IF EXISTS public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean);
DROP FUNCTION IF EXISTS public.novelight_community_report_comment(uuid,text);
DROP FUNCTION IF EXISTS public.novelight_community_report(text,text);
DROP FUNCTION IF EXISTS public.novelight_community_post_comment(text,text,uuid);
DROP FUNCTION IF EXISTS public.novelight_community_comments(text,integer);
DROP FUNCTION IF EXISTS public.novelight_community_toggle_like(text);
DROP FUNCTION IF EXISTS public.novelight_community_interaction_allowed(text);
DROP FUNCTION IF EXISTS public.novelight_community_feed(integer,integer,boolean);
DROP FUNCTION IF EXISTS public.novelight_community_post_visible(text);
DROP FUNCTION IF EXISTS public.novelight_community_reset_note_consent();
DROP FUNCTION IF EXISTS public.novelight_curation_share_reset_private();

DROP TABLE IF EXISTS public.community_notifications;
DROP TABLE IF EXISTS public.community_reports;
DROP TABLE IF EXISTS public.community_comments;
DROP TABLE IF EXISTS public.community_reactions;
DROP TABLE IF EXISTS public.community_hidden_posts;
DROP TABLE IF EXISTS public.community_user_restrictions;
DROP TABLE IF EXISTS public.community_seed_shares;
DROP TABLE IF EXISTS public.community_runtime_control;

ALTER TABLE public.author_notes DROP COLUMN IF EXISTS show_in_timeline;
ALTER TABLE public.reader_curation_lists DROP COLUMN IF EXISTS community_share_enabled;
COMMIT;
