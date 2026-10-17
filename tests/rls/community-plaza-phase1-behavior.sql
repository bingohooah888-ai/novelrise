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
END
$reader_plaza$;
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

ROLLBACK;
