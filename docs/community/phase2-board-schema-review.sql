-- REVIEW-ONLY candidate for NOVELIGHT community Phase 2 (not applied).
-- Requires Phase 1 schema. Use CLI-generated migration after review, not a
-- direct write to Production. Shared timeline/board public_enabled remains OFF.
-- Reuses Phase 1 community_comments, reports, hidden_posts and admin moderation.
-- Text-only general audience board: no novel ranks, SCOUT, SEED or PV effects.

CREATE TABLE public.community_board_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('stories','writing','general')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 4 AND 80),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz,
 deleted_at timestamptz
);
CREATE INDEX community_board_recent ON public.community_board_threads(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX community_board_author_rate ON public.community_board_threads(author_user_id,created_at DESC);
ALTER TABLE public.community_board_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_board_threads FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_board_visible(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT EXISTS(SELECT 1 FROM public.community_board_threads t
 WHERE t.id=p_id AND t.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM public.community_runtime_control c WHERE c.singleton AND c.public_enabled)
 AND NOT EXISTS(SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key='board:'||t.id::text)
 AND ((SELECT auth.uid()) IS NULL OR (
   NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE
     (b.blocker_user_id=(SELECT auth.uid()) AND b.blocked_user_id=t.author_user_id)
     OR (b.blocker_user_id=t.author_user_id AND b.blocked_user_id=(SELECT auth.uid())))
   AND NOT EXISTS(SELECT 1 FROM public.user_mutes mu
     WHERE mu.muter_user_id=(SELECT auth.uid()) AND mu.muted_user_id=t.author_user_id)
 )))
$$;
REVOKE ALL ON FUNCTION public.novelight_community_board_visible(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_board_list(
 p_category text DEFAULT NULL,p_limit integer DEFAULT 15,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_rows jsonb; v_me uuid := (SELECT auth.uid());
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 200
 OR (p_category IS NOT NULL AND p_category NOT IN ('stories','writing','general'))
 THEN RAISE EXCEPTION 'Invalid board pagination' USING errcode='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_runtime_control c WHERE c.singleton AND c.public_enabled)
 THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'category',q.category,'title',q.title,'excerpt',left(q.body,160),
  'author_name',q.author_name,'author_user_id',q.author_user_id,
  'created_at',q.created_at,'edited_at',q.edited_at,'is_mine',q.author_user_id=v_me,
  'reply_count',q.reply_count) ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb)
 INTO v_rows FROM (
  SELECT t.*,coalesce(p.display_name,'ユーザー') author_name,
    (SELECT count(*) FROM public.community_comments c
     WHERE c.post_key='board:'||t.id::text AND c.deleted_at IS NULL
      AND c.admin_hidden_at IS NULL AND (v_me IS NULL OR (
       NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE
          (b.blocker_user_id=v_me AND b.blocked_user_id=c.user_id)
          OR (b.blocker_user_id=c.user_id AND b.blocked_user_id=v_me))
       AND NOT EXISTS(SELECT 1 FROM public.user_mutes mu WHERE
          mu.muter_user_id=v_me AND mu.muted_user_id=c.user_id))
      )) reply_count
  FROM public.community_board_threads t
  LEFT JOIN public.profiles p ON p.id=t.author_user_id
  WHERE (p_category IS NULL OR t.category=p_category)
   AND public.novelight_community_board_visible(t.id)
  ORDER BY t.created_at DESC,t.id DESC LIMIT p_limit OFFSET p_offset
 ) q;
 RETURN v_rows;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_board_list(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novelight_community_board_list(text,integer,integer) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_board_detail(p_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_data jsonb; v_me uuid:=(SELECT auth.uid());
BEGIN
 IF p_thread_id IS NULL OR NOT public.novelight_community_board_visible(p_thread_id)
 THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('id',t.id,'post_key','board:'||t.id::text,
  'category',t.category,'title',t.title,'body',t.body,'author_user_id',t.author_user_id,
  'author_name',coalesce(p.display_name,'ユーザー'),'is_mine',t.author_user_id=v_me,
  'created_at',t.created_at,'edited_at',t.edited_at)
 INTO v_data FROM public.community_board_threads t
 LEFT JOIN public.profiles p ON p.id=t.author_user_id WHERE t.id=p_thread_id;
 RETURN v_data;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_board_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novelight_community_board_detail(uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_board_save(
 p_category text,p_title text,p_body text,p_general_audience_confirmed boolean,p_thread_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_me uuid := (SELECT auth.uid()); v_title text:=btrim(coalesce(p_title,''));
 v_body text:=btrim(coalesce(p_body,'')); v_saved uuid;
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_runtime_control c WHERE c.singleton AND c.public_enabled)
 THEN RAISE EXCEPTION 'Board is closed' USING errcode='42501'; END IF;
 IF p_category IS NULL OR p_category NOT IN ('stories','writing','general')
  OR char_length(v_title) NOT BETWEEN 4 AND 80
  OR char_length(v_body) NOT BETWEEN 1 AND 2000
  OR NOT coalesce(p_general_audience_confirmed,false)
 THEN RAISE EXCEPTION 'Invalid general-audience thread' USING errcode='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.community_user_restrictions r
  WHERE r.user_id=v_me AND r.expires_at>now()) THEN
  RAISE EXCEPTION 'Posting restricted' USING errcode='42501'; END IF;
 IF p_thread_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.profiles p
    WHERE p.id=v_me AND p.created_at>now()-interval '10 minutes') THEN
    RAISE EXCEPTION 'Account too new' USING errcode='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_me::text));
  IF EXISTS(SELECT 1 FROM public.community_board_threads t WHERE
    t.author_user_id=v_me AND t.created_at>now()-interval '2 minutes')
   OR (SELECT count(*) FROM public.community_board_threads t WHERE
    t.author_user_id=v_me AND t.created_at>now()-interval '1 day')>=5 THEN
    RAISE EXCEPTION 'Rate limited' USING errcode='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.community_board_threads t WHERE
    t.author_user_id=v_me AND t.title=v_title AND t.body=v_body
    AND t.created_at>now()-interval '1 day') THEN
    RAISE EXCEPTION 'Duplicate thread' USING errcode='23505'; END IF;
  INSERT INTO public.community_board_threads(author_user_id,category,title,body)
    VALUES(v_me,p_category,v_title,v_body) RETURNING id INTO v_saved;
 ELSE
  UPDATE public.community_board_threads t
   SET category=p_category,title=v_title,body=v_body,edited_at=now()
   WHERE t.id=p_thread_id AND t.author_user_id=v_me AND t.deleted_at IS NULL
    AND public.novelight_community_board_visible(t.id)
    AND (t.edited_at IS NULL OR t.edited_at<now()-interval '30 seconds')
   RETURNING t.id INTO v_saved;
  IF v_saved IS NULL THEN RAISE EXCEPTION 'Edit unavailable' USING errcode='42501'; END IF;
 END IF;
 RETURN v_saved;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_board_save(text,text,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_board_save(text,text,text,boolean,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_board_delete(p_thread_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_me uuid:=(SELECT auth.uid()); v_affected integer;
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
 UPDATE public.community_board_threads t SET deleted_at=now()
  WHERE t.id=p_thread_id AND t.author_user_id=v_me AND t.deleted_at IS NULL
   AND EXISTS(SELECT 1 FROM public.community_runtime_control c
    WHERE c.singleton AND c.public_enabled);
 GET DIAGNOSTICS v_affected=ROW_COUNT;
 IF v_affected<>1 THEN RAISE EXCEPTION 'Thread unavailable' USING errcode='42501'; END IF;
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_board_delete(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_board_delete(uuid) TO authenticated;

-- Preserve the exact Phase 1 definitions except added board identifiers.

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
    WHEN p_key ~ '^board:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
  END AND NOT EXISTS (SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key=p_key)
$$; THEN
      public.novelight_community_board_visible(substring(p_key FROM 7)::uuid)
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
  UNION ALL
  SELECT t.author_user_id,'board:'||t.id::text FROM public.community_board_threads t
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
    UNION ALL
    SELECT t.author_user_id,'board:'||t.id::text FROM public.community_board_threads t
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
    OR p_post_key !~ '^(novel:[0-9]+|note:[0-9]+|curation:[0-9]+|seed:[0-9a-f-]{36}|official:[0-9]+|ep:[0-9a-f-]{36}:[0-9]+:[0-9]+|board:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|comment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$' THEN
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
