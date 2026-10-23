-- Phase 2 rollback REVIEW CANDIDATE ONLY. Never run automatically.
-- No schema change is applied by creating this document.
-- Data preservation takes precedence: fail if any board-related record exists.
-- Requires the shared Production community runtime gate to be OFF.
DO $board_rollback_precheck$
BEGIN
 IF to_regclass('public.community_board_threads') IS NULL THEN
   RAISE EXCEPTION 'Community Phase 2 table not installed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.community_runtime_control ctl
           WHERE ctl.singleton AND ctl.public_enabled)
   OR NOT EXISTS(SELECT 1 FROM public.community_runtime_control ctl
                 WHERE ctl.singleton AND NOT ctl.public_enabled) THEN
   RAISE EXCEPTION 'Community runtime must be disabled before rollback';
 END IF;
 IF EXISTS(SELECT 1 FROM public.community_board_threads)
   OR EXISTS(SELECT 1 FROM public.community_comments WHERE post_key LIKE 'board:%')
   OR EXISTS(SELECT 1 FROM public.community_reports WHERE post_key LIKE 'board:%')
   OR EXISTS(SELECT 1 FROM public.community_notifications WHERE post_key LIKE 'board:%')
   OR EXISTS(SELECT 1 FROM public.community_reactions WHERE post_key LIKE 'board:%')
   OR EXISTS(SELECT 1 FROM public.community_hidden_posts WHERE post_key LIKE 'board:%') THEN
   RAISE EXCEPTION 'Board-related records exist; refuse destructive rollback';
 END IF;
END
$board_rollback_precheck$;

-- Restore exactly the original Phase 1 logic before removing board functions.

CREATE OR REPLACE FUNCTION public.novelight_community_post_visible(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.community_runtime_control ctl
      WHERE ctl.singleton AND ctl.public_enabled
    ) THEN false
    -- Moderation must revoke direct RPC access, not only hide the feed card.
    WHEN EXISTS (
      SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key=p_key
    ) THEN false
    WHEN p_key ~ '^novel:[0-9]+$' THEN EXISTS (
      SELECT 1
      FROM public.author_follow_events e
      JOIN public.novels n ON n.id = e.novel_id
      WHERE e.event_type = 'novel_published'
        AND p_key = 'novel:' || e.id::text
        AND n.user_id = e.author_user_id
        AND n.status = 'published'
        AND n.content_rating IN ('general', 'sensitive_15')
        AND COALESCE(n.first_published_at, n.created_at) <= now()
    )
    WHEN p_key ~ '^ep:[0-9a-f-]{36}:[0-9]+:[0-9]+$' THEN EXISTS (
      SELECT 1
      FROM public.author_follow_events e
      JOIN public.novels n ON n.id = e.novel_id
      JOIN public.episodes ep ON ep.id = e.episode_id AND ep.novel_id = n.id
      WHERE e.event_type = 'episode_published'
        AND p_key = 'ep:' || e.author_user_id::text || ':' || e.novel_id::text || ':' ||
          floor(extract(epoch FROM e.occurred_at) / 10800)::bigint::text
        AND n.user_id = e.author_user_id
        AND n.status = 'published'
        AND n.content_rating IN ('general', 'sensitive_15')
        AND ep.status = 'published'
        AND ep.first_published_at <= now()
        AND (ep.scheduled_publish_at IS NULL OR ep.scheduled_publish_at <= now())
    )
    WHEN p_key ~ '^note:[0-9]+$' THEN EXISTS (
      SELECT 1 FROM public.author_notes note
      WHERE p_key = 'note:' || note.id::text
        AND note.status = 'published'
        AND note.show_in_timeline = true
        AND note.published_at <= now()
        AND (note.linked_novel_id IS NULL OR EXISTS (
          SELECT 1 FROM public.novels linked
           WHERE linked.id=note.linked_novel_id AND linked.user_id=note.author_user_id
             AND linked.status='published'
             AND linked.content_rating IN ('general','sensitive_15')
             AND linked.first_published_at<=now()
        ))
    )
    WHEN p_key ~ '^seed:[0-9a-f-]{36}$' THEN EXISTS (
      SELECT 1 FROM public.community_seed_shares cs
      JOIN public.light_seeds s ON s.id=cs.seed_id AND s.reader_id=cs.reader_id
      JOIN public.novels n ON n.id::text=s.novel_id_snapshot
      WHERE p_key='seed:'||cs.seed_id::text AND n.status='published'
        AND n.content_rating IN ('general','sensitive_15')
        AND n.first_published_at<=now()
    )
    WHEN p_key ~ '^curation:[0-9]+$' THEN EXISTS (
     SELECT 1 FROM public.reader_curation_lists l
     WHERE p_key='curation:'||l.id::text
       AND l.visibility='shared' AND l.community_share_enabled
       AND l.share_token IS NOT NULL
    )
    WHEN p_key ~ '^official:[0-9]+$' THEN EXISTS (
      SELECT 1 FROM public.announcements a
      WHERE p_key = 'official:' || a.id::text
        AND a.status = 'published'
        AND a.published_at <= now()
    )
    ELSE false
  END AND NOT EXISTS (SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key=p_key)
$$;

CREATE OR REPLACE FUNCTION public.novelight_community_post_author(p_key text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT author_user_id FROM (
  SELECT e.author_user_id,'novel:'||e.id::text AS k FROM public.author_follow_events e
    WHERE e.event_type='novel_published'
  UNION ALL
  SELECT e.author_user_id,
    'ep:'||e.author_user_id::text||':'||e.novel_id::text||':'||
    floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text
    FROM public.author_follow_events e WHERE e.event_type='episode_published'
  UNION ALL
  SELECT n.author_user_id,'note:'||n.id::text FROM public.author_notes n
  UNION ALL
  SELECT l.owner_user_id,'curation:'||l.id::text FROM public.reader_curation_lists l
  UNION ALL
  SELECT cs.reader_id,'seed:'||cs.seed_id::text FROM public.community_seed_shares cs
 ) x WHERE x.k=p_key LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.novelight_community_interaction_allowed(p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_author uuid;
BEGIN
  IF v_user IS NULL OR NOT public.novelight_community_post_visible(p_key) THEN
    RETURN false;
  END IF;
  SELECT author_user_id INTO v_author FROM (
    SELECT e.author_user_id, 'novel:' || e.id::text AS key
      FROM public.author_follow_events e WHERE e.event_type='novel_published'
    UNION ALL
    SELECT e.author_user_id,
      'ep:' || e.author_user_id::text || ':' || e.novel_id::text ||
      ':' || floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text
      FROM public.author_follow_events e WHERE e.event_type='episode_published'
    UNION ALL
    SELECT note.author_user_id,'note:'||note.id::text
      FROM public.author_notes note
    UNION ALL
    SELECT l.owner_user_id,'curation:'||l.id::text
      FROM public.reader_curation_lists l
    UNION ALL
    SELECT cs.reader_id,'seed:'||cs.seed_id::text
      FROM public.community_seed_shares cs
  ) act WHERE act.key=p_key LIMIT 1;
  IF v_author IS NULL THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_user_id=v_user AND b.blocked_user_id=v_author)
       OR (b.blocker_user_id=v_author AND b.blocked_user_id=v_user))
    OR EXISTS(SELECT 1 FROM public.user_mutes m
    WHERE m.muter_user_id=v_user AND m.muted_user_id=v_author) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.novelight_admin_community_moderate(
 p_admin_user_id uuid,p_action text,p_post_key text DEFAULT NULL,
 p_user_id uuid DEFAULT NULL,p_reason text DEFAULT ''
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_reason text:=btrim(coalesce(p_reason,'')); v_target text;
 v_comment_id uuid; v_affected integer;
BEGIN
 IF p_admin_user_id IS NULL OR p_action NOT IN
   ('hide','restore','restrict','unrestrict')
   OR char_length(v_reason)>500 THEN
  RAISE EXCEPTION 'Invalid moderation action' USING errcode='22023';
 END IF;
 IF p_action IN ('hide','restore') THEN
  IF p_post_key IS NULL OR char_length(p_post_key)>150
    OR p_post_key !~ '^(novel:[0-9]+|note:[0-9]+|curation:[0-9]+|seed:[0-9a-f-]{36}|official:[0-9]+|ep:[0-9a-f-]{36}:[0-9]+:[0-9]+|comment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$' THEN
   RAISE EXCEPTION 'Invalid post key' USING errcode='22023';
  END IF;
  v_target:=p_post_key;
  IF left(p_post_key,8)='comment:' THEN
   v_comment_id:=substring(p_post_key FROM 9)::uuid;
   IF p_action='hide' THEN
     UPDATE public.community_comments SET admin_hidden_at=now()
      WHERE id=v_comment_id AND deleted_at IS NULL;
   ELSE
     UPDATE public.community_comments SET admin_hidden_at=NULL
      WHERE id=v_comment_id AND deleted_at IS NULL;
   END IF;
   GET DIAGNOSTICS v_affected = ROW_COUNT;
   IF v_affected<>1 THEN
     RAISE EXCEPTION 'Comment unavailable' USING errcode='22023';
   END IF;
   IF p_action='hide' THEN
     UPDATE public.community_reports SET status='resolved',updated_at=now()
      WHERE post_key=p_post_key AND status IN ('pending','reviewing');
   END IF;
  ELSIF p_action='hide' THEN
   INSERT INTO public.community_hidden_posts(post_key,hidden_by,reason)
     VALUES(p_post_key,p_admin_user_id,v_reason)
     ON CONFLICT(post_key) DO UPDATE SET hidden_by=excluded.hidden_by,
       reason=excluded.reason,hidden_at=now();
   UPDATE public.community_reports SET status='resolved',updated_at=now()
     WHERE post_key=p_post_key AND status IN ('pending','reviewing');
  ELSE
   DELETE FROM public.community_hidden_posts WHERE post_key=p_post_key;
  END IF;
 ELSE
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Invalid user' USING errcode='22023'; END IF;
  v_target:=p_user_id::text;
  IF p_action='restrict' THEN
   IF char_length(v_reason)=0 THEN
     RAISE EXCEPTION 'Restriction reason required' USING errcode='22023';
   END IF;
   INSERT INTO public.community_user_restrictions(user_id,imposed_by,reason,expires_at)
    VALUES(p_user_id,p_admin_user_id,v_reason,now()+interval '7 days')
    ON CONFLICT(user_id) DO UPDATE SET imposed_by=excluded.imposed_by,
      reason=excluded.reason,expires_at=excluded.expires_at,created_at=now();
  ELSE
   DELETE FROM public.community_user_restrictions WHERE user_id=p_user_id;
  END IF;
 END IF;
 INSERT INTO public.admin_operation_audit(
  admin_user_id,action,resource_type,resource_id,metadata)
 VALUES(p_admin_user_id,'community.'||p_action,
   CASE WHEN left(coalesce(p_post_key,''),8)='comment:' AND
     p_action IN ('hide','restore') THEN 'community_comment'
     WHEN p_action IN ('hide','restore') THEN 'community_post'
     ELSE 'community_user' END,
   v_target,jsonb_build_object('reason',v_reason));
 RETURN true;
END
$$;
-- Remove only the new Phase 2 functions, all in the empty and disabled case.
DROP FUNCTION public.novelight_community_board_delete(uuid);
DROP FUNCTION public.novelight_community_board_save(text,text,text,boolean,uuid);
DROP FUNCTION public.novelight_community_board_detail(uuid);
DROP FUNCTION public.novelight_community_board_list(text,integer,integer);
DROP FUNCTION public.novelight_community_board_visible(uuid);

-- Do not CASCADE or delete any user-authored records.
DROP TABLE public.community_board_threads;
