-- REVIEW ONLY: execute only after confirming the original feed contract
-- and publicly shared profile icons are still required to be removed.
-- No profile image or stored media is deleted.
BEGIN;
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
  IF p_following AND v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to view followed authors' USING errcode = '42501';
  END IF;
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
       AND n.status='published'
       AND n.content_rating IN ('general','sensitive_15')
       AND ep.status='published'
       AND ep.first_published_at<=now()
       AND (ep.scheduled_publish_at IS NULL OR ep.scheduled_publish_at<=now())
     GROUP BY e.author_user_id,n.id,n.title,n.thumbnail_url,
              floor(extract(epoch FROM e.occurred_at)/10800)::bigint
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
    SELECT a.*, coalesce(p.display_name, '作者') AS author_name
    FROM activity a
    LEFT JOIN public.profiles p ON p.id=a.author_user_id
    WHERE (NOT p_following OR EXISTS (
      SELECT 1 FROM public.author_follows f
      WHERE f.follower_user_id=v_user AND f.author_user_id=a.author_user_id
    ))
      AND (
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
DROP FUNCTION IF EXISTS public.novelight_public_author_avatar(uuid);
COMMIT;
