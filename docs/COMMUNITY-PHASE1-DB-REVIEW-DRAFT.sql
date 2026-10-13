-- NOVELIGHT Community Plaza Phase 1 (REVIEW DRAFT ONLY)
-- DO NOT APPLY TO PRODUCTION. A formal migration must be generated with
-- "supabase migration new" after approval and validated on an authorized target.
-- Existing author_follow_events are canonical; no duplicate event trigger.
-- Separate from Rank, SCOUT RECORD, LIGHT SEED and impression systems.
BEGIN;

ALTER TABLE public.author_notes
  ADD COLUMN IF NOT EXISTS show_in_timeline boolean NOT NULL DEFAULT false;

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

-- Restrict feed/event interaction to currently public source rows. Notes opt in
-- explicitly and automatically disappear on archive / delete.
CREATE OR REPLACE FUNCTION public.novelight_community_post_visible(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
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
    )
    WHEN p_key ~ '^official:[0-9]+$' THEN EXISTS (
      SELECT 1 FROM public.announcements a
      WHERE p_key = 'official:' || a.id::text
        AND a.status = 'published'
        AND a.published_at <= now()
    )
    ELSE false
  END
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
  IF p_following AND v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to view followed authors' USING errcode = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 OR
     p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 300 THEN
    RAISE EXCEPTION 'Invalid pagination' USING errcode = '22023';
  END IF;

  WITH activity AS (
    SELECT 'novel'::text AS kind, 'novel:' || e.id::text AS post_key,
           e.author_user_id, n.id AS novel_id, n.title AS novel_title,
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
    SELECT 'episode', 'ep:' || e.author_user_id::text || ':' || e.novel_id::text ||
                   ':' || floor(extract(epoch FROM e.occurred_at)/10800)::bigint::text,
           e.author_user_id, n.id, n.title, n.thumbnail_url,
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
           note.author_user_id, linked.id, linked.title, linked.thumbnail_url,
           note.title,note.body,note.id,note.published_at
      FROM public.author_notes note
      LEFT JOIN public.novels linked
        ON linked.id=note.linked_novel_id AND linked.user_id=note.author_user_id
       AND linked.status='published'
       AND linked.content_rating IN ('general','sensitive_15')
     WHERE note.status='published'
       AND note.show_in_timeline
       AND note.published_at<=now()
    UNION ALL
    SELECT 'official', 'official:' || a.id::text,
           NULL::uuid,NULL::bigint,NULL::text,NULL::text,
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
    SELECT * FROM accepted ORDER BY occurred_at DESC,post_key DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
       'kind',p.kind,'post_key',p.post_key,'author_user_id',p.author_user_id,
       'author_name', CASE WHEN p.kind='official' THEN 'NOVELIGHT公式' ELSE p.author_name END,
       'novel_id',p.novel_id,'novel_title',p.novel_title,
       'thumbnail_url',p.thumbnail_url,'title',p.title,'body',p.body,
       'note_id',p.note_id,'occurred_at',p.occurred_at,
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
  IF NOT public.novelight_community_post_visible(p_post_key) THEN
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
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'body',r.body,'display_name',r.display_name,'created_at',r.created_at
   ) ORDER BY r.created_at ASC),'[]'::jsonb)
   INTO v_output FROM (
    SELECT c.id,c.body,p.display_name,c.created_at
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

CREATE OR REPLACE FUNCTION public.novelight_community_post_comment(p_post_key text,p_body text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user uuid:=(SELECT auth.uid()); v_body text:=btrim(coalesce(p_body,''));
        v_comment_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Comment length must be 1-500' USING errcode='22023';
  END IF;
  IF NOT public.novelight_community_post_visible(p_post_key) THEN
    RAISE EXCEPTION 'Post unavailable' USING errcode='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user
      AND p.created_at > now()-interval '10 minutes') THEN
    RAISE EXCEPTION 'Account too new' USING errcode='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text));
  IF EXISTS(SELECT 1 FROM public.community_comments c WHERE c.user_id=v_user
        AND c.created_at>now()-interval '20 seconds') OR
     (SELECT count(*) FROM public.community_comments c WHERE c.user_id=v_user
        AND c.created_at>now()-interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'Comment rate limited' USING errcode='42901';
  END IF;
  IF EXISTS(SELECT 1 FROM public.community_comments c
     WHERE c.user_id=v_user AND c.post_key=p_post_key AND c.body=v_body
       AND c.created_at>now()-interval '1 day') THEN
    RAISE EXCEPTION 'Duplicate comment' USING errcode='23505';
  END IF;
  INSERT INTO public.community_comments(post_key,user_id,body)
    VALUES(p_post_key,v_user,v_body) RETURNING id INTO v_comment_id;
  RETURN jsonb_build_object('id',v_comment_id);
END
$$;
REVOKE ALL ON FUNCTION public.novelight_community_post_comment(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_community_post_comment(text,text) TO authenticated;

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
  IF NOT public.novelight_community_post_visible(p_post_key) THEN
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

-- Legacy note RPC retains its API and ownership checks. Opt-in/save is atomic
-- by invoking it from the new v2 wrapper rather than writing raw note records.
CREATE OR REPLACE FUNCTION public.novelight_save_my_author_note_v2(
 p_note_id bigint,p_title text,p_body text,
 p_linked_novel_id bigint DEFAULT NULL,p_show_in_timeline boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb; v_user uuid:=(SELECT auth.uid()); v_note_id bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Login required' USING errcode='42501'; END IF;
  v_result:=public.novelight_save_my_author_note(p_note_id,p_title,p_body,p_linked_novel_id);
  v_note_id:=(v_result->>'note_id')::bigint;
  UPDATE public.author_notes SET show_in_timeline=coalesce(p_show_in_timeline,false)
   WHERE id=v_note_id AND author_user_id=v_user AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Note unavailable' USING errcode='42501'; END IF;
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean) TO authenticated;

-- Management note RPC must be replaced, owner-bound, to additionally include
-- 'show_in_timeline' in each JSON object without raw table exposure.
-- Admin RLS and moderation RPCs, notification idempotency, and analytics require
-- an additional reviewed migration before the release flag can be enabled.
COMMIT;
