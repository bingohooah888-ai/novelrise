\set ON_ERROR_STOP on
-- Community Phase 1 cross-user and public-consent scenarios.
-- This test runs ONLY on disposable CI migration replay PostgreSQL.
BEGIN;

-- CI-only activation inside transaction; test rolls back every change.
DO $before_release$
BEGIN
 IF (SELECT public_enabled FROM public.community_runtime_control WHERE singleton) THEN
  RAISE EXCEPTION 'Community gate was enabled before owner approval';
 END IF;
 IF jsonb_array_length(public.novelight_community_feed(5,0,false))<>0 THEN
  RAISE EXCEPTION 'Public community RPC active before release';
 END IF;
 UPDATE public.community_runtime_control SET public_enabled=true WHERE singleton=true;
END
$before_release$;

INSERT INTO auth.users(id,raw_user_meta_data) VALUES
 ('c0a00000-0000-4000-8000-000000000001','{"display_name":"Plaza Test Author"}'::jsonb),
 ('c0a00000-0000-4000-8000-000000000002','{"display_name":"Plaza Test Reader"}'::jsonb)
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.profiles(id,display_name,created_at) VALUES
 ('c0a00000-0000-4000-8000-000000000001','Plaza Test Author',now()-interval '2 days'),
 ('c0a00000-0000-4000-8000-000000000002','Plaza Test Reader',now()-interval '2 days')
ON CONFLICT(id) DO UPDATE
 SET display_name=excluded.display_name,created_at=excluded.created_at;

DO $setup_plaza$
DECLARE v_note bigint;
BEGIN
 INSERT INTO public.author_notes(author_user_id,title,body,status)
 VALUES ('c0a00000-0000-4000-8000-000000000001',
         'Plaza fixture note','Public fixture body','published')
 RETURNING id INTO v_note;
 PERFORM set_config('novelight.test.community_note',v_note::text,true);
 UPDATE public.author_notes SET show_in_timeline=true WHERE id=v_note;
 IF NOT public.novelight_community_post_visible('note:'||v_note::text) THEN
   RAISE EXCEPTION 'Explicitly opted-in note was not publicly visible';
 END IF;
END
$setup_plaza$;

SET LOCAL ROLE anon;
DO $guest_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN RAISE EXCEPTION 'Opted-in note missing from guest feed'; END IF;
END
$guest_plaza$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $reader_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
  v_result jsonb;
BEGIN
 v_result:=public.novelight_community_toggle_like(v_key);
 IF (v_result->>'liked')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Reader like on public note failed';
 END IF;
 v_result:=public.novelight_community_post_comment(v_key,'First shared fixture comment',NULL);
 IF v_result->>'id' IS NULL THEN
   RAISE EXCEPTION 'Reader comment on public note failed';
 END IF;
 PERFORM set_config('novelight.test.community_comment',v_result->>'id',true);
END
$reader_plaza$;
RESET ROLE;


-- Recently added read/edit APIs must be scoped to one post and its author.
-- Keep all fixtures transaction-local; never touch hosted users or data.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $comment_owner_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
 v_id uuid:=current_setting('novelight.test.community_comment')::uuid;
 v_result jsonb;
BEGIN
 v_result:=public.novelight_community_comment_detail(v_key,v_id);
 IF v_result->>'body' IS DISTINCT FROM 'First shared fixture comment'
    OR (v_result->>'is_mine')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Owner comment detail is missing or incorrect';
 END IF;
 IF public.novelight_community_edit_my_comment(v_id,'Edited fixture comment') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Comment author failed to edit';
 END IF;
 v_result:=public.novelight_community_comment_detail(v_key,v_id);
 IF v_result->>'body' IS DISTINCT FROM 'Edited fixture comment'
    OR v_result->>'edited_at' IS NULL THEN
   RAISE EXCEPTION 'Comment edit not visible through detail RPC';
 END IF;
 IF public.novelight_community_comment_detail('note:0',v_id) IS NOT NULL THEN
   RAISE EXCEPTION 'Comment detail accepted a different post key';
 END IF;
 BEGIN
   PERFORM public.novelight_community_edit_my_comment(v_id,'Second rapid edit');
   RAISE EXCEPTION 'Comment edit bypassed rate limit';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$comment_owner_plaza$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
DO $comment_other_user_plaza$
DECLARE v_id uuid:=current_setting('novelight.test.community_comment')::uuid;
BEGIN
 BEGIN
   PERFORM public.novelight_community_edit_my_comment(v_id,'Illicit other-user edit');
   RAISE EXCEPTION 'Non-owner edited a community comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.novelight_community_delete_my_comment(v_id);
   RAISE EXCEPTION 'Non-owner deleted a community comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$comment_other_user_plaza$;
RESET ROLE;

-- Existing Block controls must apply to both feed and direct comments/actions.
INSERT INTO public.user_blocks(blocker_user_id,blocked_user_id) VALUES
 ('c0a00000-0000-4000-8000-000000000001',
  'c0a00000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $blocked_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN RAISE EXCEPTION 'Blocked author leaked to reader feed'; END IF;
 IF jsonb_array_length(public.novelight_community_comments(v_key,20))<>0 THEN
   RAISE EXCEPTION 'Blocked author direct comments RPC leaked';
 END IF;
 IF public.novelight_community_comment_detail(
   v_key,current_setting('novelight.test.community_comment')::uuid) IS NOT NULL THEN
   RAISE EXCEPTION 'Blocked author comment detail leaked';
 END IF;
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Blocked author allowed interaction';
 END IF;
 BEGIN
   PERFORM public.novelight_community_toggle_like(v_key);
   RAISE EXCEPTION 'Blocked reader liked author post';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$blocked_plaza$;
RESET ROLE;

DELETE FROM public.user_blocks
 WHERE blocker_user_id='c0a00000-0000-4000-8000-000000000001'
   AND blocked_user_id='c0a00000-0000-4000-8000-000000000002';
INSERT INTO public.user_mutes(muter_user_id,muted_user_id) VALUES
 ('c0a00000-0000-4000-8000-000000000002',
  'c0a00000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $muted_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Muted author allowed interaction';
 END IF;
 IF jsonb_array_length(public.novelight_community_comments(v_key,20))<>0 THEN
   RAISE EXCEPTION 'Muted author direct comments RPC leaked';
 END IF;
 BEGIN
   PERFORM public.novelight_community_toggle_like(v_key);
   RAISE EXCEPTION 'Muted reader liked author post';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$muted_plaza$;
RESET ROLE;
DELETE FROM public.user_mutes
 WHERE muter_user_id='c0a00000-0000-4000-8000-000000000002'
   AND muted_user_id='c0a00000-0000-4000-8000-000000000001';

-- Hiding must revoke visibility and every direct interaction path immediately.
INSERT INTO public.community_hidden_posts(post_key,hidden_by,reason)
VALUES (
 'note:'||current_setting('novelight.test.community_note'),
 'c0a00000-0000-4000-8000-000000000001',
 'CI fixture moderation'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $hidden_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Hidden post remains visible to direct RPC';
 END IF;
 IF jsonb_array_length(public.novelight_community_comments(v_key,20))<>0 THEN
   RAISE EXCEPTION 'Hidden post comments leaked via RPC';
 END IF;
 IF public.novelight_community_comment_detail(
   v_key,current_setting('novelight.test.community_comment')::uuid) IS NOT NULL THEN
   RAISE EXCEPTION 'Admin-hidden post comment detail leaked';
 END IF;
 BEGIN
   PERFORM public.novelight_community_toggle_like(v_key);
   RAISE EXCEPTION 'Hidden post accepted direct like';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.novelight_community_report(v_key,'hidden fixture');
   RAISE EXCEPTION 'Hidden post accepted direct report';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$hidden_plaza$;
RESET ROLE;

DELETE FROM public.community_hidden_posts
 WHERE post_key='note:'||current_setting('novelight.test.community_note');

-- Legacy note editor must not preserve consent after source text changes.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
SELECT public.novelight_save_my_author_note(
 current_setting('novelight.test.community_note')::bigint,
 'Updated via legacy editor','Updated public body',NULL
);
DO $legacy_note_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Legacy edit silently retained global feed permission';
 END IF;
END
$legacy_note_plaza$;
SELECT public.novelight_save_my_author_note_v2(
 current_setting('novelight.test.community_note')::bigint,
 'Re-approved by author','Fresh general-audience text',NULL,true,true
);
DO $v2_note_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Re-confirmed V2 note was not published';
 END IF;
END
$v2_note_plaza$;
RESET ROLE;

-- Shared-link visibility is narrower than explicit global feed consent.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
SELECT set_config(
 'novelight.test.community_list',
 public.novelight_create_my_curation_list('Plaza reader picks','CI list body')->>'list_id',
 true
);
SELECT public.novelight_update_my_curation_list(
 current_setting('novelight.test.community_list')::bigint,
 'Plaza reader picks','CI list body','shared'
);
DO $unlisted_plaza$
DECLARE v_key text:='curation:'||current_setting('novelight.test.community_list');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Shared URL alone caused global discovery';
 END IF;
END
$unlisted_plaza$;

SELECT public.novelight_set_my_curation_community_share(
 current_setting('novelight.test.community_list')::bigint,true
);
DO $opted_list_plaza$
DECLARE v_key text:='curation:'||current_setting('novelight.test.community_list');
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Explicit opt-in curation list not discoverable';
 END IF;
END
$opted_list_plaza$;

SELECT public.novelight_rotate_my_curation_share_token(
 current_setting('novelight.test.community_list')::bigint
);
DO $rotated_list_plaza$
DECLARE v_key text:='curation:'||current_setting('novelight.test.community_list');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Rotated share-token retained public feed consent';
 END IF;
END
$rotated_list_plaza$;

SELECT public.novelight_set_my_curation_community_share(
 current_setting('novelight.test.community_list')::bigint,true
);
SELECT public.novelight_update_my_curation_list(
 current_setting('novelight.test.community_list')::bigint,
 'Plaza reader picks','Description changed after opt-in','shared'
);
DO $edited_list_plaza$
DECLARE v_key text:='curation:'||current_setting('novelight.test.community_list');
BEGIN
 IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(public.novelight_community_feed(30,0,false)) item
   WHERE item->>'post_key'=v_key
 ) THEN
   RAISE EXCEPTION 'Edited list silently retained public feed consent';
 END IF;
END
$edited_list_plaza$;
RESET ROLE;

-- Owner-only global permission; another user must not enable a private list.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
DO $not_owner_plaza$
BEGIN
 BEGIN
   PERFORM public.novelight_set_my_curation_community_share(
      current_setting('novelight.test.community_list')::bigint,true
   );
   RAISE EXCEPTION 'Other user changed global curation consent';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$not_owner_plaza$;
RESET ROLE;

-- Only authenticated actors may report comments or acknowledge notifications.
-- Readers must never be able to enumerate another user's inbox or private rows.
DO $community_rpc_grants$
BEGIN
 IF has_function_privilege('anon',
     'public.novelight_community_report_comment(uuid,text)','EXECUTE')
    OR has_function_privilege('anon',
     'public.novelight_community_my_notifications(integer)','EXECUTE')
    OR has_function_privilege('anon',
     'public.novelight_community_mark_notifications_read(bigint[])','EXECUTE')
    OR NOT has_function_privilege('authenticated',
     'public.novelight_community_report_comment(uuid,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated',
     'public.novelight_community_my_notifications(integer)','EXECUTE')
    OR NOT has_function_privilege('authenticated',
     'public.novelight_community_mark_notifications_read(bigint[])','EXECUTE') THEN
   RAISE EXCEPTION 'Comment reports or notification RPC grants unsafe';
 END IF;
END
$community_rpc_grants$;

-- A reader's like and comment should generate distinct, owner-only alerts.
-- Editing the original comment must not create additional notifications.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
DO $owner_notifications_plaza$
DECLARE v_alerts jsonb; v_ids bigint[];
 v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
BEGIN
 v_alerts:=public.novelight_community_my_notifications(40);
 IF jsonb_array_length(v_alerts)<>2
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_alerts) e WHERE e->>'kind'='like')
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_alerts) e WHERE e->>'kind'='comment') THEN
   RAISE EXCEPTION 'Owner notifications missing, duplicated, or misclassified';
 END IF;
 SELECT array_agg((e->>'id')::bigint) INTO v_ids
   FROM jsonb_array_elements(v_alerts) e;
 PERFORM set_config('novelight.test.community_owner_alert',v_ids[1]::text,true);
 IF public.novelight_community_mark_notifications_read(v_ids)<>2
    OR public.novelight_community_mark_notifications_read(v_ids)<>0 THEN
   RAISE EXCEPTION 'Owner notification read acknowledgement not idempotent';
 END IF;
 IF public.novelight_community_report_comment(v_comment,'Report fixture comment')
      IS DISTINCT FROM true
    OR public.novelight_community_report_comment(v_comment,'Duplicate fixture report')
      IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Visible comment report failed';
 END IF;
END
$owner_notifications_plaza$;
RESET ROLE;

-- A normal logged-in user cannot invoke staff moderation or dismiss reports.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $community_staff_grants$
BEGIN
 IF has_function_privilege(current_user,
    'public.novelight_admin_community_moderate(uuid,text,text,uuid,text)','EXECUTE')
    OR has_function_privilege(current_user,
    'public.novelight_admin_community_dismiss_report(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated reader has administrative RPC access';
 END IF;
END
$community_staff_grants$;
-- Keep the post-level report independent of the prior comment report.
SELECT public.novelight_community_report(
 'note:'||current_setting('novelight.test.community_note'),'CI post report for dismissal'
);
RESET ROLE;

-- Exercise the real privileged RPCs in disposable CI only.
-- Hiding a comment must resolve its report and restoring it must not
-- reinstate the already-handled report. Dismissing a separate report
-- must not hide the underlying post.
-- The service role is deliberately not granted raw private-table SELECT.
-- Invoke staff RPCs under that role, then inspect outcomes after RESET ROLE
-- as the disposable CI database owner. Never weaken the private table grants.
SET LOCAL ROLE service_role;
SELECT public.novelight_admin_community_moderate(
 'c0a00000-0000-4000-8000-000000000001','hide',
 'comment:'||current_setting('novelight.test.community_comment'),NULL,
 'CI hide moderation'
);
RESET ROLE;

DO $community_hidden_moderation$
DECLARE v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.community_comments c
                WHERE c.id=v_comment AND c.admin_hidden_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Moderator failed to hide a community comment';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.community_reports r
                WHERE r.post_key='comment:'||v_comment::text
                  AND r.status='resolved') THEN
   RAISE EXCEPTION 'Hiding a reported comment failed to resolve its report';
 END IF;
END
$community_hidden_moderation$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
DO $community_hidden_detail$
BEGIN
 IF public.novelight_community_comment_detail(
    'note:'||current_setting('novelight.test.community_note'),
    current_setting('novelight.test.community_comment')::uuid
 ) IS NOT NULL THEN
   RAISE EXCEPTION 'Hidden comment leaked from direct-detail RPC';
 END IF;
END
$community_hidden_detail$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT public.novelight_admin_community_moderate(
 'c0a00000-0000-4000-8000-000000000001','restore',
 'comment:'||current_setting('novelight.test.community_comment'),NULL,
 'CI restore moderation'
);
RESET ROLE;

DO $community_restored_moderation$
DECLARE v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
 v_report uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.community_comments c
                WHERE c.id=v_comment AND c.admin_hidden_at IS NULL) THEN
   RAISE EXCEPTION 'Moderator failed to restore community comment';
 END IF;
 SELECT r.id INTO v_report FROM public.community_reports r
 WHERE r.post_key='note:'||current_setting('novelight.test.community_note')
  AND r.reporter_user_id='c0a00000-0000-4000-8000-000000000002';
 IF v_report IS NULL THEN
   RAISE EXCEPTION 'Fixture post report unavailable for dismissal';
 END IF;
 PERFORM set_config('novelight.test.community_post_report',v_report::text,true);
END
$community_restored_moderation$;

SET LOCAL ROLE service_role;
SELECT public.novelight_admin_community_dismiss_report(
 'c0a00000-0000-4000-8000-000000000001',
 current_setting('novelight.test.community_post_report')::uuid
);
RESET ROLE;

DO $community_dismissed_moderation$
DECLARE v_report uuid:=current_setting('novelight.test.community_post_report')::uuid;
 v_post_key text:='note:'||current_setting('novelight.test.community_note');
 v_admin uuid:='c0a00000-0000-4000-8000-000000000001';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.community_reports r
                  WHERE r.id=v_report AND r.status='dismissed')
    OR EXISTS (SELECT 1 FROM public.community_hidden_posts h
                 WHERE h.post_key=v_post_key) THEN
    RAISE EXCEPTION 'Dismissing a report incorrectly hid the post';
 END IF;
 IF (SELECT count(*) FROM public.admin_operation_audit a
       WHERE a.admin_user_id=v_admin AND a.action IN
         ('community.hide','community.restore','community.dismiss_report'))<3 THEN
    RAISE EXCEPTION 'Staff moderation actions were not audited';
 END IF;
END
$community_dismissed_moderation$;

-- Admin-hidden comments must not be readable via the ordinary RPC
-- even while the containing post itself remains visible.
-- Restore returns the same saved comment, without silently re-posting it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000001',true);
DO $community_restored_detail$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
 v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
BEGIN
 IF public.novelight_community_comment_detail(v_key,v_comment)->>'body'
       IS DISTINCT FROM 'Edited fixture comment' THEN
   RAISE EXCEPTION 'Restored comment missing from normal direct-detail RPC';
 END IF;
END
$community_restored_detail$;
RESET ROLE;

-- The commenter cannot read or acknowledge the author's notifications;
-- deleting their own comment must hide its deep link and revoke its alert.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c0a00000-0000-4000-8000-000000000002',true);
DO $reader_notification_delete_plaza$
DECLARE v_key text:='note:'||current_setting('novelight.test.community_note');
 v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
 v_alert bigint:=current_setting('novelight.test.community_owner_alert')::bigint;
BEGIN
 IF jsonb_array_length(public.novelight_community_my_notifications(40))<>0 THEN
   RAISE EXCEPTION 'Another user notifications leaked to commenter';
 END IF;
 IF public.novelight_community_mark_notifications_read(ARRAY[v_alert])<>0 THEN
   RAISE EXCEPTION 'Commenter acknowledged another user notification';
 END IF;
 IF public.novelight_community_delete_my_comment(v_comment) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Comment owner failed to delete';
 END IF;
 IF public.novelight_community_comment_detail(v_key,v_comment) IS NOT NULL
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(
     public.novelight_community_comments(v_key,20)) item
     WHERE item->>'id'=v_comment::text) THEN
   RAISE EXCEPTION 'Deleted comment leaked through direct read RPCs';
 END IF;
 BEGIN
   PERFORM public.novelight_community_report_comment(v_comment,'Deleted comment');
   RAISE EXCEPTION 'Deleted comment accepted new report';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.novelight_community_delete_my_comment(v_comment);
   RAISE EXCEPTION 'Deleted comment was deleted twice';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$reader_notification_delete_plaza$;
RESET ROLE;

DO $deleted_comment_effects_plaza$
DECLARE v_comment uuid:=current_setting('novelight.test.community_comment')::uuid;
 v_reports integer; v_deleted_alerts integer;
BEGIN
 SELECT count(*) INTO v_reports FROM public.community_reports
 WHERE post_key='comment:'||v_comment::text
  AND reporter_user_id='c0a00000-0000-4000-8000-000000000001';
 IF v_reports<>1 THEN RAISE EXCEPTION 'Duplicate comment report stored'; END IF;
 SELECT count(*) INTO v_deleted_alerts FROM public.community_notifications
 WHERE event_key='comment:'||v_comment::text;
 IF v_deleted_alerts<>0 THEN
   RAISE EXCEPTION 'Deleted comment notification was not removed';
 END IF;
END
$deleted_comment_effects_plaza$;

ROLLBACK;
