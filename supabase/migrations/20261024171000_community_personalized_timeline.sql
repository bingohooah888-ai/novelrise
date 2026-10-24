-- Personalized NOVELIGHT community timeline.
-- Legacy three-hour cards retain their exact keys and associated interactions.
-- Each new episode has a unique, stable key: offset 1e12 + follow event ID.
-- No private-table read access is granted to browsers.
BEGIN;

CREATE TABLE public.community_episode_key_cutover (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 legacy_max_event_id bigint NOT NULL CHECK(legacy_max_event_id >= 0),
 activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.community_episode_key_cutover(singleton,legacy_max_event_id)
 SELECT true,COALESCE(MAX(id),0)::bigint FROM public.author_follow_events;
ALTER TABLE public.community_episode_key_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_episode_key_cutover FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_feed(
  p_limit integer DEFAULT 15,
  p_offset integer DEFAULT 0,
  p_following boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := (select auth.uid());
  v_rows jsonb;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.community_runtime_control ctl
    WHERE ctl.singleton AND ctl.public_enabled
  ) THEN RETURN '[]'::jsonb; END IF;
  -- p_following remains for API compatibility; all viewers use one timeline.
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 OR
     p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 300 THEN
    RAISE EXCEPTION 'Invalid pagination' USING errcode = '22023';
  END IF;

  WITH activity AS (
    SELECT 'novel'::text AS kind, 'novel:' || e.id::text AS post_key,
           e.author_user_id, n.id AS novel_id, NULL::bigint AS episode_id, n.title AS novel_title,
           n.thumbnail_url, '新作「' || n.title || '」を公開しました' AS title,
           NULL::text AS body, NULL::bigint AS note_id,
           e.occurred_at
      FROM public.author_follow_events e
      JOIN public.novels n ON n.id=e.novel_id AND n.user_id=e.author_user_id
     WHERE e.event_type='novel_published'
       AND n.status='published'
       AND n.content_rating IN ('general','sensitive_15')
       AND COALESCE(n.first_published_at,n.created_at)<=now()
    UNION ALL
    SELECT 'episode', 'ep:' || e.author_user_id::text || ':' || n.id::text ||
                   ':' || floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text,
           e.author_user_id, n.id, CASE WHEN count(DISTINCT e.episode_id)=1 THEN max(e.episode_id) ELSE NULL::bigint END,
           n.title, n.thumbnail_url,
           '「' || n.title || '」の' || count(DISTINCT e.episode_id)::text || 'エピソードを公開しました',
           NULL::text, NULL::bigint, max(e.occurred_at)
      FROM public.author_follow_events e
      JOIN public.novels n ON n.id=e.novel_id AND n.user_id=e.author_user_id
      JOIN public.episodes ep ON ep.id=e.episode_id AND ep.novel_id=n.id
     WHERE e.event_type='episode_published'
       AND e.id <= (SELECT legacy_max_event_id FROM public.community_episode_key_cutover WHERE singleton)
       AND v_user IS NOT NULL AND (EXISTS(SELECT 1 FROM public.author_follows f WHERE f.follower_user_id=v_user AND f.author_user_id=e.author_user_id) OR EXISTS(SELECT 1 FROM public.favorites fav WHERE fav.user_id=v_user AND fav.novel_id=n.id))
       AND n.status='published'
       AND n.content_rating IN ('general','sensitive_15')
       AND ep.status='published'
       AND ep.first_published_at<=now()
       AND (ep.scheduled_publish_at IS NULL OR ep.scheduled_publish_at<=now())
     GROUP BY e.author_user_id,n.id,n.title,n.thumbnail_url,
              floor(extract(epoch FROM e.occurred_at)/10800)::bigint
    UNION ALL
    SELECT 'episode', 'ep:' || e.author_user_id::text || ':' || n.id::text || ':' ||
                  (1000000000000::bigint + e.id)::text,
           e.author_user_id, n.id, e.episode_id, n.title, n.thumbnail_url,
           '「' || n.title || '」の1エピソードを公開しました',
           NULL::text, NULL::bigint, e.occurred_at
      FROM public.author_follow_events e
      JOIN public.novels n ON n.id=e.novel_id AND n.user_id=e.author_user_id
      JOIN public.episodes ep ON ep.id=e.episode_id AND ep.novel_id=n.id
     WHERE e.event_type='episode_published'
       AND e.id > (SELECT legacy_max_event_id FROM public.community_episode_key_cutover WHERE singleton)
       AND v_user IS NOT NULL AND (EXISTS(SELECT 1 FROM public.author_follows f WHERE f.follower_user_id=v_user AND f.author_user_id=e.author_user_id) OR EXISTS(SELECT 1 FROM public.favorites fav WHERE fav.user_id=v_user AND fav.novel_id=n.id))
       AND n.status='published'
       AND n.content_rating IN ('general','sensitive_15')
       AND ep.status='published'
       AND ep.first_published_at<=now()
       AND (ep.scheduled_publish_at IS NULL OR ep.scheduled_publish_at<=now())
    UNION ALL
    SELECT 'note','note:' || note.id::text,
           note.author_user_id, linked.id, NULL::bigint, linked.title, linked.thumbnail_url,
           note.title,note.body,note.id,note.published_at
      FROM public.author_notes note
      LEFT JOIN public.novels linked
        ON linked.id=note.linked_novel_id AND linked.user_id=note.author_user_id
       AND linked.status='published'
       AND linked.content_rating IN ('general','sensitive_15')
       AND linked.first_published_at<=now()
     WHERE note.status='published'
       AND note.show_in_timeline
       AND note.published_at<=now()
        AND (note.linked_novel_id IS NULL OR linked.id IS NOT NULL)
    UNION ALL
    SELECT 'seed','seed:'||cs.seed_id::text,
           cs.reader_id,n.id,NULL::bigint,n.title,n.thumbnail_url,
           '「'||n.title||'」にLIGHT SEEDを贈りました',NULL::text,
           NULL::bigint,cs.created_at
      FROM public.community_seed_shares cs
      JOIN public.light_seeds s ON s.id=cs.seed_id AND s.reader_id=cs.reader_id
      JOIN public.novels n ON n.id::text=s.novel_id_snapshot
     WHERE n.status='published' AND n.content_rating IN ('general','sensitive_15')
       AND n.first_published_at<=now()
    UNION ALL
    SELECT 'curation', 'curation:' || l.id::text,
           l.owner_user_id,NULL::bigint,NULL::bigint,NULL::text,NULL::text,
           'おすすめリスト「' || l.title || '」を公開しました',
           left(l.description,500)::text,NULL::bigint,l.updated_at
      FROM public.reader_curation_lists l
     WHERE l.visibility='shared' AND l.community_share_enabled
       AND l.share_token IS NOT NULL
    UNION ALL
    SELECT 'official', 'official:' || a.id::text,
           NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::text,
           a.title,left(a.body,500)::text,NULL::bigint,a.published_at
      FROM public.announcements a
     WHERE a.status='published' AND a.published_at<=now()
  ),
  accepted AS (
    SELECT a.*, coalesce(p.display_name, '作者') AS author_name,
           CASE WHEN a.kind='official' THEN official_profile.avatar_path
                ELSE p.avatar_path END AS author_avatar_path,
           CASE WHEN a.kind='official' THEN official_profile.id
                ELSE a.author_user_id END AS author_avatar_user_id
    FROM activity a
    LEFT JOIN public.profiles p ON p.id=a.author_user_id
    -- Keep official moderation/visibility identity unchanged; only source
    -- the image from the first recorded ADMIN creator of each announcement.
    LEFT JOIN LATERAL (
      SELECT audit.admin_user_id
      FROM public.admin_operation_audit audit
      WHERE a.kind='official'
        AND audit.action='announcement.create'
        AND audit.resource_type='announcement'
        AND audit.resource_id=split_part(a.post_key, ':', 2)
      ORDER BY audit.id ASC
      LIMIT 1
    ) official_owner ON true
    LEFT JOIN public.profiles official_profile
      ON official_profile.id=official_owner.admin_user_id
    WHERE (
        v_user IS NULL OR a.author_user_id IS NULL OR (
          NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_user_id=v_user AND b.blocked_user_id=a.author_user_id)
                         OR (b.blocker_user_id=a.author_user_id AND b.blocked_user_id=v_user))
          AND NOT EXISTS (SELECT 1 FROM public.user_mutes m
                          WHERE m.muter_user_id=v_user AND m.muted_user_id=a.author_user_id)
        )
      )
  ),
  paged AS (
    SELECT * FROM accepted a
    WHERE NOT EXISTS (SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key=a.post_key)
    ORDER BY occurred_at DESC,post_key DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
       'kind',p.kind,'post_key',p.post_key,'author_user_id',p.author_user_id,
       'author_name', CASE WHEN p.kind='official' THEN 'NOVELIGHT公式' ELSE p.author_name END,
       'author_avatar_path',p.author_avatar_path,
       'author_avatar_user_id',p.author_avatar_user_id,
       'novel_id',p.novel_id,'episode_id',p.episode_id,'novel_title',p.novel_title,
       'thumbnail_url',p.thumbnail_url,'title',p.title,'body',p.body,
       'note_id',p.note_id,'occurred_at',p.occurred_at,
       'curation_share_token',CASE WHEN p.kind='curation' THEN (
         SELECT l.share_token::text FROM public.reader_curation_lists l
         WHERE p.post_key='curation:'||l.id::text
           AND l.visibility='shared' AND l.community_share_enabled
       ) ELSE NULL::text END,
       'like_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_key=p.post_key),
       'liked_by_me', EXISTS(SELECT 1 FROM public.community_reactions r
                            WHERE r.post_key=p.post_key AND r.user_id=v_user),
       'comment_count', (SELECT count(*) FROM public.community_comments c
                         WHERE c.post_key=p.post_key AND c.deleted_at IS NULL AND c.admin_hidden_at IS NULL)
    ) ORDER BY p.occurred_at DESC,p.post_key DESC),'[]'::jsonb)
    INTO v_rows
    FROM paged p;
  RETURN v_rows;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_feed(integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novelight_community_feed(integer,integer,boolean) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_post_visible(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      SELECT 1 FROM public.author_follow_events e
      JOIN public.novels n ON n.id=e.novel_id AND n.user_id=e.author_user_id
      JOIN public.episodes ep ON ep.id=e.episode_id AND ep.novel_id=n.id
      WHERE e.event_type='episode_published'
        AND p_key = 'ep:' || e.author_user_id::text || ':' || e.novel_id::text || ':' ||
         CASE WHEN e.id <= (SELECT legacy_max_event_id FROM public.community_episode_key_cutover WHERE singleton)
              THEN floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text
              ELSE (1000000000000::bigint + e.id)::text END
        AND (SELECT auth.uid()) IS NOT NULL
        AND (
          EXISTS(SELECT 1 FROM public.author_follows f
                 WHERE f.follower_user_id=(SELECT auth.uid()) AND f.author_user_id=e.author_user_id)
          OR EXISTS(SELECT 1 FROM public.favorites fav
                    WHERE fav.user_id=(SELECT auth.uid()) AND fav.novel_id=n.id)
        )
        AND n.status='published'
        AND n.content_rating IN ('general','sensitive_15')
        AND ep.status='published'
        AND ep.first_published_at<=now()
        AND (ep.scheduled_publish_at IS NULL OR ep.scheduled_publish_at<=now())
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
    WHEN p_key ~ '^board:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      public.novelight_community_board_visible(substring(p_key FROM 7)::uuid)
    ELSE false
  END AND NOT EXISTS (SELECT 1 FROM public.community_hidden_posts h WHERE h.post_key=p_key)
$function$

REVOKE ALL ON FUNCTION public.novelight_community_post_visible(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_interaction_allowed(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_user uuid:=(SELECT auth.uid()); v_author uuid;
BEGIN
  IF v_user IS NULL OR NOT public.novelight_community_post_visible(p_key) THEN
    RETURN false;
  END IF;
  SELECT author_user_id INTO v_author FROM (
    SELECT e.author_user_id, 'novel:' || e.id::text AS key
      FROM public.author_follow_events e WHERE e.event_type='novel_published'
    UNION ALL
    SELECT e.author_user_id, 'ep:' || e.author_user_id::text || ':' || e.novel_id::text || ':' ||
         CASE WHEN e.id <= (SELECT legacy_max_event_id FROM public.community_episode_key_cutover WHERE singleton)
              THEN floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text
              ELSE (1000000000000::bigint + e.id)::text END AS key FROM public.author_follow_events e
      WHERE e.event_type='episode_published'
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
$function$

REVOKE ALL ON FUNCTION public.novelight_community_interaction_allowed(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_post_author(p_key text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT author_user_id FROM (
  SELECT e.author_user_id,'novel:'||e.id::text AS k FROM public.author_follow_events e
    WHERE e.event_type='novel_published'
  UNION ALL
  SELECT e.author_user_id, 'ep:' || e.author_user_id::text || ':' || e.novel_id::text || ':' ||
         CASE WHEN e.id <= (SELECT legacy_max_event_id FROM public.community_episode_key_cutover WHERE singleton)
              THEN floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text
              ELSE (1000000000000::bigint + e.id)::text END AS k FROM public.author_follow_events e
    WHERE e.event_type='episode_published'
  UNION ALL
  SELECT n.author_user_id,'note:'||n.id::text FROM public.author_notes n
  UNION ALL
  SELECT l.owner_user_id,'curation:'||l.id::text FROM public.reader_curation_lists l
  UNION ALL
  SELECT cs.reader_id,'seed:'||cs.seed_id::text FROM public.community_seed_shares cs
  UNION ALL
  SELECT t.author_user_id,'board:'||t.id::text FROM public.community_board_threads t
 ) x WHERE x.k=p_key LIMIT 1
$function$

REVOKE ALL ON FUNCTION public.novelight_community_post_author(text) FROM PUBLIC,anon,authenticated;
COMMIT;
