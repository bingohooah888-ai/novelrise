-- NOVELIGHT Community Plaza Phase 1, migration 20261014052000
-- Author/reader community feature is GATED OFF at deployment by default.
-- No existing rows are made public: note and curated-list opt-in default false.
-- Private interaction tables have RLS on and no anon/authenticated table grants.
-- This migration does not publish the feature or grant OWNER release approval.
BEGIN;

-- This independent DB gate, not the UI flag, controls direct client RPCs.
-- No public access is enabled by this migration.
CREATE TABLE IF NOT EXISTS public.community_runtime_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 public_enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz,
 activated_by uuid
);
INSERT INTO public.community_runtime_control(singleton,public_enabled)
 VALUES(true,false) ON CONFLICT(singleton) DO NOTHING;
ALTER TABLE public.community_runtime_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_runtime_control FROM PUBLIC,anon,authenticated;

ALTER TABLE public.author_notes
  ADD COLUMN IF NOT EXISTS show_in_timeline boolean NOT NULL DEFAULT false;
ALTER TABLE public.reader_curation_lists
 ADD COLUMN IF NOT EXISTS community_share_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.community_seed_shares (
 seed_id uuid PRIMARY KEY REFERENCES public.light_seeds(id) ON DELETE CASCADE,
 reader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_seed_shares_reader_idx ON public.community_seed_shares(reader_id);
ALTER TABLE public.community_seed_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_seed_shares FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS public.community_reactions (
  post_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reactions_pk PRIMARY KEY (post_key, user_id),
  CONSTRAINT community_reactions_key_len CHECK (length(post_key) BETWEEN 3 AND 150)
);
CREATE INDEX IF NOT EXISTS community_reactions_user_idx ON public.community_reactions(user_id);
ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reactions FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  admin_hidden_at timestamptz,
  CONSTRAINT community_comments_key_len CHECK (length(post_key) BETWEEN 3 AND 150)
);
CREATE INDEX IF NOT EXISTS community_comments_post_idx
  ON public.community_comments(post_key, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND admin_hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS community_comments_user_rate_idx
  ON public.community_comments(user_id, created_at DESC);
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_comments FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_key text NOT NULL,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reports_one_per_person UNIQUE (post_key, reporter_user_id)
);
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reports FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_hidden_posts (
  post_key text PRIMARY KEY,
  hidden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  hidden_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_hidden_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_hidden_posts FROM PUBLIC, anon, authenticated;

-- Restrict feed/event interaction to currently public source rows. Notes opt in
-- explicitly and automatically disappear on archive / delete.
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
REVOKE ALL ON FUNCTION public.novelight_community_post_visible(text) FROM PUBLIC, anon, authenticated;

-- Feed: bounded DB pagination, no user-generated fake content, no realtime,
-- no plan rank preference; group an author's novel episodes into three-hour buckets.
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

-- Check the other person's Block/Mute status for individual actions, even when
-- a client crafts a post key instead of navigating through the filtered feed.
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
REVOKE ALL ON FUNCTION public.novelight_community_interaction_allowed(text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_toggle_like(p_post_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_deleted integer;
  v_liked boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  IF NOT public.novelight_community_interaction_allowed(p_post_key) THEN
    RAISE EXCEPTION 'Post unavailable' USING errcode='42501';
  END IF;
  -- One request/user/post at a time; unique primary key also prevents duplicates.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text),
                                            pg_catalog.hashtext(p_post_key));
  DELETE FROM public.community_reactions
   WHERE user_id=v_user AND post_key=p_post_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted=0 THEN
    INSERT INTO public.community_reactions(post_key,user_id) VALUES (p_post_key,v_user);
    v_liked=true;
    INSERT INTO public.community_notifications(recipient_user_id,actor_user_id,post_key,kind,event_key)
    SELECT owner_id,v_user,p_post_key,'like','like:'||p_post_key||':'||v_user::text
    FROM (SELECT public.novelight_community_post_author(p_post_key) AS owner_id) sub
    WHERE owner_id IS NOT NULL AND owner_id<>v_user
    ON CONFLICT(event_key) DO NOTHING;
  ELSE
    v_liked=false;
  END IF;
  RETURN jsonb_build_object('liked',v_liked,'like_count',
    (SELECT count(*) FROM public.community_reactions WHERE post_key=p_post_key));
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_toggle_like(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_toggle_like(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_comments(p_post_key text,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_output jsonb; v_uid uuid:=(SELECT auth.uid());
BEGIN
  IF NOT public.novelight_community_post_visible(p_post_key) THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Logged-in users must not bypass author Block/Mute via direct comments RPC.
  IF v_uid IS NOT NULL AND NOT public.novelight_community_interaction_allowed(p_post_key) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'body',r.body,'parent_comment_id',r.parent_comment_id,
    'display_name',r.display_name,'created_at',r.created_at
   ) ORDER BY r.created_at ASC),'[]'::jsonb)
   INTO v_output FROM (
    SELECT c.id,c.body,c.parent_comment_id,p.display_name,c.created_at
    FROM public.community_comments c
    JOIN public.profiles p ON p.id=c.user_id
    WHERE c.post_key=p_post_key AND c.deleted_at IS NULL AND c.admin_hidden_at IS NULL
      AND (v_uid IS NULL OR (
         NOT EXISTS(SELECT 1 FROM public.user_blocks b
           WHERE (b.blocker_user_id=v_uid AND b.blocked_user_id=c.user_id)
              OR (b.blocker_user_id=c.user_id AND b.blocked_user_id=v_uid))
         AND NOT EXISTS(SELECT 1 FROM public.user_mutes m
           WHERE m.muter_user_id=v_uid AND m.muted_user_id=c.user_id)
      ))
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT least(greatest(coalesce(p_limit,20),1),50)
   ) r;
  RETURN v_output;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_comments(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novelight_community_comments(text,integer) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_post_comment(
 p_post_key text,p_body text,p_parent_comment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid());
  v_body text:=btrim(coalesce(p_body,''));
  v_comment_id uuid;
  v_parent_author uuid;
  v_post_author uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Comment length must be 1-500' USING errcode='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.community_user_restrictions
            WHERE user_id=v_user AND expires_at>now()) THEN
    RAISE EXCEPTION 'Community posting restricted' USING errcode='42501';
  END IF;
  IF NOT public.novelight_community_interaction_allowed(p_post_key) THEN
    RAISE EXCEPTION 'Post unavailable' USING errcode='42501';
  END IF;
  IF p_parent_comment_id IS NOT NULL THEN
    SELECT c.user_id INTO v_parent_author FROM public.community_comments c
     WHERE c.id=p_parent_comment_id AND c.post_key=p_post_key
       AND c.deleted_at IS NULL AND c.admin_hidden_at IS NULL;
    IF v_parent_author IS NULL THEN
      RAISE EXCEPTION 'Invalid reply target' USING errcode='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_user_id=v_user AND b.blocked_user_id=v_parent_author)
         OR (b.blocker_user_id=v_parent_author AND b.blocked_user_id=v_user))
      OR EXISTS(SELECT 1 FROM public.user_mutes m
      WHERE m.muter_user_id=v_user AND m.muted_user_id=v_parent_author) THEN
      RAISE EXCEPTION 'Reply unavailable' USING errcode='42501';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_user
     AND p.created_at>now()-interval '10 minutes') THEN
    RAISE EXCEPTION 'Account too new' USING errcode='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text));
  IF EXISTS(SELECT 1 FROM public.community_comments c
      WHERE c.user_id=v_user AND c.created_at>now()-interval '20 seconds')
    OR (SELECT count(*) FROM public.community_comments c
      WHERE c.user_id=v_user AND c.created_at>now()-interval '1 day')>=30 THEN
    RAISE EXCEPTION 'Comment rate limited' USING errcode='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.community_comments c WHERE c.user_id=v_user
      AND c.post_key=p_post_key AND c.body=v_body
      AND c.created_at>now()-interval '1 day') THEN
    RAISE EXCEPTION 'Duplicate comment' USING errcode='23505';
  END IF;
  INSERT INTO public.community_comments(post_key,user_id,body,parent_comment_id)
    VALUES(p_post_key,v_user,v_body,p_parent_comment_id) RETURNING id INTO v_comment_id;
  v_post_author:=public.novelight_community_post_author(p_post_key);
  IF v_parent_author IS NOT NULL AND v_parent_author<>v_user THEN
    INSERT INTO public.community_notifications(recipient_user_id,actor_user_id,post_key,kind,event_key)
    VALUES(v_parent_author,v_user,p_post_key,'reply','reply:'||v_comment_id::text)
    ON CONFLICT(event_key) DO NOTHING;
  END IF;
  IF v_post_author IS NOT NULL AND v_post_author<>v_user AND
     v_post_author IS DISTINCT FROM v_parent_author THEN
    INSERT INTO public.community_notifications(recipient_user_id,actor_user_id,post_key,kind,event_key)
    VALUES(v_post_author,v_user,p_post_key,'comment','comment:'||v_comment_id::text)
    ON CONFLICT(event_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('id',v_comment_id);
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_post_comment(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_post_comment(text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_report(p_post_key text,p_reason text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  IF char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid report reason' USING errcode='22023';
  END IF;
  IF NOT public.novelight_community_interaction_allowed(p_post_key) THEN
    RAISE EXCEPTION 'Post unavailable' USING errcode='42501';
  END IF;
  INSERT INTO public.community_reports(post_key,reporter_user_id,reason)
    VALUES(p_post_key,v_user,v_reason)
    ON CONFLICT (post_key,reporter_user_id) DO NOTHING;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_report(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_report(text,text) TO authenticated;

-- Legacy note edits revoke previous global feed consent.
CREATE OR REPLACE FUNCTION public.novelight_community_reset_note_consent()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
 IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
   OR NEW.linked_novel_id IS DISTINCT FROM OLD.linked_novel_id
   OR NEW.status IS DISTINCT FROM OLD.status THEN
   NEW.show_in_timeline:=false;
 END IF;
 RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_reset_note_consent() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS community_author_note_consent_guard ON public.author_notes;
CREATE TRIGGER community_author_note_consent_guard
 BEFORE UPDATE OF title,body,linked_novel_id,status ON public.author_notes
 FOR EACH ROW EXECUTE FUNCTION public.novelight_community_reset_note_consent();

-- Legacy note RPC retains its API and ownership checks. Opt-in/save is atomic
-- by invoking it from the new v2 wrapper rather than writing raw note records.
CREATE OR REPLACE FUNCTION public.novelight_save_my_author_note_v2(
 p_note_id bigint,p_title text,p_body text,
 p_linked_novel_id bigint DEFAULT NULL,p_show_in_timeline boolean DEFAULT false,
 p_general_audience_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb; v_user uuid:=(SELECT auth.uid()); v_note_id bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  IF coalesce(p_show_in_timeline,false) AND NOT EXISTS(
    SELECT 1 FROM public.community_runtime_control ctl WHERE ctl.singleton AND ctl.public_enabled
  ) THEN RAISE EXCEPTION 'Community not available yet' USING errcode='42501'; END IF;
  IF coalesce(p_show_in_timeline,false) AND NOT coalesce(p_general_audience_confirmed,false) THEN
    RAISE EXCEPTION 'General audience confirmation required' USING errcode='42501';
  END IF;
  v_result:=public.novelight_save_my_author_note(p_note_id,p_title,p_body,p_linked_novel_id);
  v_note_id:=(v_result->>'note_id')::bigint;
  UPDATE public.author_notes SET show_in_timeline=coalesce(p_show_in_timeline,false)
   WHERE id=v_note_id AND author_user_id=v_user AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Note unavailable' USING errcode='42501'; END IF;
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean) TO authenticated;

-- Extend management output without replacing the old RPC or exposing raw notes.
CREATE OR REPLACE FUNCTION public.novelight_manage_my_author_notes_v2(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(item.value || jsonb_build_object(
   'show_in_timeline',coalesce((SELECT n.show_in_timeline
   FROM public.author_notes n WHERE n.id=(item.value->>'id')::bigint AND n.author_user_id=v_user),false)
  ) ORDER BY (item.value->>'updated_at') DESC),'[]'::jsonb)
 INTO v_result
 FROM jsonb_array_elements(public.novelight_manage_my_author_notes(p_limit)) item(value);
 RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_manage_my_author_notes_v2(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_manage_my_author_notes_v2(integer) TO authenticated;


-- Staff-only visibility and temporary posting restrictions.
CREATE TABLE IF NOT EXISTS public.community_user_restrictions (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 imposed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_user_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_user_restrictions FROM PUBLIC,anon,authenticated;

-- Internal alert inbox for likes/comments. Follower publication events continue
-- using the EXISTING author-follow notifications; never duplicate them here.
CREATE TABLE IF NOT EXISTS public.community_notifications (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 post_key text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('like','comment','reply')),
 event_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_notifications_recipient_idx
 ON public.community_notifications (recipient_user_id,created_at DESC);
ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_notifications FROM PUBLIC,anon,authenticated;

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
REVOKE ALL ON FUNCTION public.novelight_community_post_author(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.novelight_community_my_notifications(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'kind',r.kind,'post_key',r.post_key,'created_at',r.created_at,
  'actor_name',r.actor_name,'read_at',r.read_at
 ) ORDER BY r.created_at DESC),'[]'::jsonb) INTO v_result
 FROM (
  SELECT n.id,n.kind,n.post_key,n.created_at,n.read_at,
    coalesce(p.display_name,'ユーザー') AS actor_name
  FROM public.community_notifications n JOIN public.profiles p ON p.id=n.actor_user_id
  WHERE n.recipient_user_id=v_user
    AND public.novelight_community_post_visible(n.post_key)
    AND NOT EXISTS(SELECT 1 FROM public.user_blocks b
         WHERE (b.blocker_user_id=v_user AND b.blocked_user_id=n.actor_user_id)
            OR (b.blocker_user_id=n.actor_user_id AND b.blocked_user_id=v_user))
    AND NOT EXISTS(SELECT 1 FROM public.user_mutes m
         WHERE m.muter_user_id=v_user AND m.muted_user_id=n.actor_user_id)
  ORDER BY n.created_at DESC LIMIT least(greatest(coalesce(p_limit,20),1),40)
 ) r;
 RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_my_notifications(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_my_notifications(integer) TO authenticated;

-- A notification is owned by its recipient. Clients can acknowledge at most
-- forty of their own rows per request, never another user's notices.
CREATE OR REPLACE FUNCTION public.novelight_community_mark_notifications_read(
 p_ids bigint[]
)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $
DECLARE v_user uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
 IF v_user IS NULL THEN
   RAISE EXCEPTION 'Sign in required' USING errcode='42501';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.community_runtime_control ctl
   WHERE ctl.singleton AND ctl.public_enabled
 ) THEN
   RAISE EXCEPTION 'Community not available' USING errcode='42501';
 END IF;
 IF coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 40 OR
    EXISTS (SELECT 1 FROM unnest(p_ids) AS i(id)
            WHERE i.id IS NULL OR i.id<=0) THEN
   RAISE EXCEPTION 'Invalid notification IDs' USING errcode='22023';
 END IF;
 UPDATE public.community_notifications n
    SET read_at=now()
  WHERE n.recipient_user_id=v_user
    AND n.id=ANY(p_ids)
    AND n.read_at IS NULL;
 GET DIAGNOSTICS v_updated = ROW_COUNT;
 RETURN v_updated;
END
$;
REVOKE ALL ON FUNCTION public.novelight_community_mark_notifications_read(bigint[])
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_mark_notifications_read(bigint[])
  TO authenticated;

-- Staff write is atomic with existing ADMIN audit; only a service-role call from
-- a requireAdmin-protected Vercel API is permitted. Not a public client RPC.
CREATE OR REPLACE FUNCTION public.novelight_admin_community_moderate(
 p_admin_user_id uuid,p_action text,p_post_key text DEFAULT NULL,
 p_user_id uuid DEFAULT NULL,p_reason text DEFAULT ''
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_reason text:=btrim(coalesce(p_reason,'')); v_target text;
BEGIN
 IF p_admin_user_id IS NULL OR p_action NOT IN
   ('hide','restore','restrict','unrestrict')
   OR char_length(v_reason)>500 THEN
  RAISE EXCEPTION 'Invalid moderation action' USING errcode='22023';
 END IF;
 IF p_action IN ('hide','restore') THEN
  IF p_post_key IS NULL OR char_length(p_post_key)>150
    OR p_post_key !~ '^(novel:[0-9]+|note:[0-9]+|curation:[0-9]+|seed:[0-9a-f-]{36}|official:[0-9]+|ep:[0-9a-f-]{36}:[0-9]+:[0-9]+)$' THEN
   RAISE EXCEPTION 'Invalid post key' USING errcode='22023';
  END IF;
  v_target:=p_post_key;
  IF p_action='hide' THEN
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
   CASE WHEN p_action IN ('hide','restore') THEN 'community_post' ELSE 'community_user' END,
   v_target,jsonb_build_object('reason',v_reason));
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_admin_community_moderate(uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novelight_admin_community_moderate(uuid,text,text,uuid,text) TO service_role;

-- Staging preflight 2026-10-14: corrected six-arg grant and closed blocked-author
-- comment and R18-linked note backdoors. Staging schema must not be mutated
-- outside the OWNER-approved #294 ledger; this is still a review-only draft.
-- Share-token access is NOT permission for global discovery.
-- A separate owner-bound opt-in is required and defaults to FALSE.
CREATE OR REPLACE FUNCTION public.novelight_manage_my_curation_lists_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$ 
DECLARE v_user uuid:=(SELECT auth.uid()); v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(item.value || pg_catalog.jsonb_build_object(
    'community_share_enabled',coalesce((SELECT l.community_share_enabled
      FROM public.reader_curation_lists l
      WHERE l.id=(item.value->>'list_id')::bigint AND l.owner_user_id=v_user),false)
  ) ORDER BY (item.value->>'updated_at')::timestamptz DESC),'[]'::jsonb)
 INTO v_result FROM pg_catalog.jsonb_array_elements(
   public.novelight_manage_my_curation_lists()) item(value);
 RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_manage_my_curation_lists_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_manage_my_curation_lists_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.novelight_set_my_curation_community_share(
 p_list_id bigint,p_enabled boolean
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid());
BEGIN
 IF v_user IS NULL OR p_list_id IS NULL OR p_enabled IS NULL THEN
   RAISE EXCEPTION 'Invalid request' USING errcode='42501';
 END IF;
 IF p_enabled AND NOT EXISTS(
   SELECT 1 FROM public.community_runtime_control ctl WHERE ctl.singleton AND ctl.public_enabled
 ) THEN RAISE EXCEPTION 'Community not available yet' USING errcode='42501'; END IF;
 UPDATE public.reader_curation_lists l
    SET community_share_enabled=p_enabled,updated_at=now()
  WHERE l.id=p_list_id AND l.owner_user_id=v_user
    AND (NOT p_enabled OR (l.visibility='shared' AND l.share_token IS NOT NULL));
 IF NOT FOUND THEN RAISE EXCEPTION 'List unavailable' USING errcode='42501'; END IF;
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_set_my_curation_community_share(bigint,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_set_my_curation_community_share(bigint,boolean)
 TO authenticated;

-- Existing owner update RPC stays unchanged; switching to private revokes opt-in.
CREATE OR REPLACE FUNCTION public.novelight_curation_share_reset_private()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
 IF new.visibility <> 'shared'
   OR new.share_token IS DISTINCT FROM old.share_token
   OR new.title IS DISTINCT FROM old.title
   OR new.description IS DISTINCT FROM old.description THEN
   new.community_share_enabled:=false;
 END IF;
 RETURN new;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_curation_share_reset_private() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS community_curation_visibility_guard ON public.reader_curation_lists;
CREATE TRIGGER community_curation_visibility_guard
 BEFORE UPDATE OF visibility,share_token,title,description ON public.reader_curation_lists
 FOR EACH ROW EXECUTE FUNCTION public.novelight_curation_share_reset_private();

-- A LIGHT SEED award is never automatically announced. Donor consent
-- is separate from the original award and is reversible.
CREATE OR REPLACE FUNCTION public.novelight_my_seed_community_shares()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(cs.seed_id),'[]'::jsonb) INTO v_result
 FROM public.community_seed_shares cs WHERE cs.reader_id=v_user;
 RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_my_seed_community_shares() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_my_seed_community_shares() TO authenticated;

CREATE OR REPLACE FUNCTION public.novelight_set_my_seed_community_share(
 p_seed_id uuid,p_enabled boolean
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid());
BEGIN
 IF v_user IS NULL OR p_seed_id IS NULL OR p_enabled IS NULL THEN
   RAISE EXCEPTION 'Invalid request' USING errcode='42501';
 END IF;
 IF p_enabled AND NOT EXISTS(
   SELECT 1 FROM public.community_runtime_control ctl WHERE ctl.singleton AND ctl.public_enabled
 ) THEN RAISE EXCEPTION 'Community not available yet' USING errcode='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.light_seeds s WHERE s.id=p_seed_id AND s.reader_id=v_user) THEN
   RAISE EXCEPTION 'Seed unavailable' USING errcode='42501';
 END IF;
 IF p_enabled THEN
   IF NOT EXISTS(
     SELECT 1 FROM public.light_seeds s
     JOIN public.novels n ON n.id::text=s.novel_id_snapshot
     WHERE s.id=p_seed_id AND s.reader_id=v_user AND n.status='published'
       AND n.content_rating IN ('general','sensitive_15')
       AND n.first_published_at<=now()
   ) THEN RAISE EXCEPTION 'Work unavailable' USING errcode='42501'; END IF;
   INSERT INTO public.community_seed_shares(seed_id,reader_id)
    VALUES(p_seed_id,v_user) ON CONFLICT(seed_id) DO NOTHING;
 ELSE
   DELETE FROM public.community_seed_shares
   WHERE seed_id=p_seed_id AND reader_id=v_user;
 END IF;
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_set_my_seed_community_share(uuid,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_set_my_seed_community_share(uuid,boolean)
 TO authenticated;

-- Read-only staff KPI. This uses already-qualified valid-read events; neither
-- journey entries nor community interactions create valid reads, PV or XP.
-- Only server-side requireAdmin -> service_role may execute it.
CREATE OR REPLACE FUNCTION public.novelight_admin_community_metrics(
 p_days integer DEFAULT 7
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_start timestamptz;
  v_entries bigint;
  v_visitors bigint;
  v_reads bigint;
  v_interactors bigint;
  v_repeat bigint;
BEGIN
 IF p_days IS NULL OR p_days NOT IN (7,30) THEN
   RAISE EXCEPTION 'Period must be 7 or 30 days' USING errcode='22023';
 END IF;
 v_start:=now()-pg_catalog.make_interval(days=>p_days);

 SELECT count(*),count(DISTINCT e.viewer_key_hash)
   INTO v_entries,v_visitors
 FROM public.reader_journey_events e
 WHERE e.source='community' AND e.occurred_at>=v_start
   AND e.event_type IN ('detail_open','episode_read_10s');

 -- Only existing server-qualified valid reads count as reading outcomes.
 -- Attribution to a prior community journey is bounded to 24 hours.
 SELECT count(DISTINCT vr.id) INTO v_reads
 FROM public.valid_read_events vr
 WHERE vr.qualified_at>=v_start AND vr.reader_id IS NOT NULL
   AND EXISTS(
     SELECT 1 FROM public.reader_journey_events e
     WHERE e.source='community'
       AND e.user_id=vr.reader_id
       AND e.novel_id_snapshot=vr.novel_id_snapshot
       AND e.event_type IN ('detail_open','episode_read_10s')
       AND e.occurred_at<=vr.qualified_at
       AND e.occurred_at>=vr.qualified_at-interval '24 hours'
   );

 WITH interactions AS (
   SELECT user_id,created_at FROM public.community_reactions
     WHERE created_at>=v_start
   UNION ALL
   SELECT user_id,created_at FROM public.community_comments
     WHERE created_at>=v_start AND deleted_at IS NULL AND admin_hidden_at IS NULL
 ), daily AS (
   SELECT user_id,pg_catalog.date_trunc('day',created_at AT TIME ZONE 'Asia/Tokyo') AS day
   FROM interactions GROUP BY user_id,pg_catalog.date_trunc('day',created_at AT TIME ZONE 'Asia/Tokyo')
 ), actor_days AS (
   SELECT user_id,count(*) AS days_active FROM daily GROUP BY user_id
 )
 SELECT count(*),count(*) FILTER (WHERE days_active>=2)
 INTO v_interactors,v_repeat FROM actor_days;

 RETURN pg_catalog.jsonb_build_object(
   'days',p_days,'journey_entries',v_entries,
   'unique_visitors',v_visitors,'qualified_reads',v_reads,
   'interactors',v_interactors,'repeat_interactors',v_repeat
 );
END
$$;
REVOKE ALL ON FUNCTION public.novelight_admin_community_metrics(integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novelight_admin_community_metrics(integer)
 TO service_role;

COMMIT;
