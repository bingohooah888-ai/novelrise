\set ON_ERROR_STOP on
-- Staging-only Community Phase 1 interaction proof.
-- ONE PostgreSQL connection / transaction. This transaction is NEVER committed.
-- A psql error closes the session and PostgreSQL rolls back all changes.
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '5s';

DO $setup$
DECLARE
  v_event bigint;
  v_author uuid;
  v_reader uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.community_runtime_control
     WHERE singleton AND public_enabled = false
  ) THEN
    RAISE EXCEPTION 'Staging community gate must start OFF';
  END IF;
  IF (
    SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version = '20261014052000'
  ) <> 1 THEN
    RAISE EXCEPTION 'Expected one installed Phase 1 migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_reactions
    UNION ALL SELECT 1 FROM public.community_comments
    UNION ALL SELECT 1 FROM public.community_reports
  ) THEN
    RAISE EXCEPTION 'Staging already has community interactions; refuse fixtures';
  END IF;

  SELECT e.id, e.author_user_id, p.id
    INTO v_event, v_author, v_reader
    FROM public.author_follow_events e
    JOIN public.novels n ON n.id = e.novel_id
    JOIN public.profiles p ON p.id <> e.author_user_id
   WHERE e.event_type = 'novel_published'
     AND n.user_id = e.author_user_id
     AND n.status = 'published'
     AND n.content_rating IN ('general','sensitive_15')
     AND coalesce(n.first_published_at, n.created_at) <= now()
     AND p.created_at <= now() - interval '10 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_user_id=p.id AND b.blocked_user_id=e.author_user_id)
           OR (b.blocker_user_id=e.author_user_id AND b.blocked_user_id=p.id)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_mutes m
        WHERE m.muter_user_id=p.id AND m.muted_user_id=e.author_user_id
     )
   ORDER BY e.id, p.created_at
   LIMIT 1;
  IF v_event IS NULL OR v_author IS NULL OR v_reader IS NULL THEN
    RAISE EXCEPTION 'No Staging-only eligible author/reader fixture';
  END IF;
  PERFORM pg_catalog.set_config('novelight.smoke.post_key', 'novel:' || v_event::text, true);
  PERFORM pg_catalog.set_config('novelight.smoke.author', v_author::text, true);
  PERFORM pg_catalog.set_config('novelight.smoke.reader', v_reader::text, true);
END
$setup$;

-- The gate is changed only *inside an uncommitted transaction*.
-- Other sessions continue to see the committed OFF state at all times.
UPDATE public.community_runtime_control
   SET public_enabled = true
 WHERE singleton AND public_enabled = false;
DO $assert_gate$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.community_runtime_control
   WHERE singleton AND public_enabled = true
 ) THEN RAISE EXCEPTION 'Transient gate setup failed'; END IF;
END
$assert_gate$;

SET LOCAL ROLE authenticated;
DO $authenticate$
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    pg_catalog.current_setting('novelight.smoke.reader'), true
  );
END
$authenticate$;

DO $interaction$
DECLARE
  v_key text := pg_catalog.current_setting('novelight.smoke.post_key');
  v_like jsonb;
  v_comment jsonb;
  v_ok boolean;
  v_rate_limited boolean := false;
BEGIN
  -- Private guard functions are intentionally not executable by authenticated.
  -- The following granted RPCs prove visibility/authorization end to end.
  IF pg_catalog.jsonb_typeof(public.novelight_community_feed(10,0,false))
     IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Feed did not return an array';
  END IF;

  v_like := public.novelight_community_toggle_like(v_key);
  IF (v_like->>'liked')::boolean IS DISTINCT FROM true
     OR (v_like->>'like_count')::integer <> 1 THEN
    RAISE EXCEPTION 'Like insert failed';
  END IF;
  v_like := public.novelight_community_toggle_like(v_key);
  IF (v_like->>'liked')::boolean IS DISTINCT FROM false
     OR (v_like->>'like_count')::integer <> 0 THEN
    RAISE EXCEPTION 'Unlike failed';
  END IF;
  v_comment := public.novelight_community_post_comment(
    v_key,'Staging-only transaction rollback proof',NULL
  );
  IF v_comment->>'id' IS NULL
     OR (SELECT count(*) FROM public.community_comments WHERE post_key=v_key) <> 1 THEN
    RAISE EXCEPTION 'Comment insert failed';
  END IF;
  IF pg_catalog.jsonb_array_length(
    public.novelight_community_comments(v_key,20)
  ) <> 1 THEN RAISE EXCEPTION 'Comment was not returned'; END IF;

  BEGIN
    PERFORM public.novelight_community_post_comment(
      v_key,'Rate-limited Staging-only second comment',NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rate_limited := true;
  END;
  IF NOT v_rate_limited THEN RAISE EXCEPTION 'Comment rate limit failed'; END IF;

  v_ok := public.novelight_community_report(v_key,'Staging-only report smoke');
  IF v_ok IS DISTINCT FROM true OR (
    SELECT count(*) FROM public.community_reports WHERE post_key=v_key
  ) <> 1 THEN RAISE EXCEPTION 'Report insert failed'; END IF;
  PERFORM public.novelight_community_report(v_key,'Staging-only report smoke');
  IF (SELECT count(*) FROM public.community_reports WHERE post_key=v_key) <> 1 THEN
    RAISE EXCEPTION 'Duplicate report not deduplicated';
  END IF;
END
$interaction$;

RESET ROLE;
-- Block/Mute are simulated as rollback-contained test fixtures.
INSERT INTO public.user_blocks(blocker_user_id,blocked_user_id)
VALUES (
  pg_catalog.current_setting('novelight.smoke.reader')::uuid,
  pg_catalog.current_setting('novelight.smoke.author')::uuid
);
SET LOCAL ROLE authenticated;
DO $block$
DECLARE v_key text := pg_catalog.current_setting('novelight.smoke.post_key');
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.novelight_community_toggle_like(v_key);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Block bypassed through like RPC'; END IF;
  IF pg_catalog.jsonb_array_length(
     public.novelight_community_comments(v_key,20)
  ) <> 0 THEN RAISE EXCEPTION 'Block leaked comments'; END IF;
END
$block$;

RESET ROLE;
DELETE FROM public.user_blocks
 WHERE blocker_user_id = pg_catalog.current_setting('novelight.smoke.reader')::uuid
   AND blocked_user_id = pg_catalog.current_setting('novelight.smoke.author')::uuid;
INSERT INTO public.user_mutes(muter_user_id,muted_user_id)
VALUES (
  pg_catalog.current_setting('novelight.smoke.reader')::uuid,
  pg_catalog.current_setting('novelight.smoke.author')::uuid
);
SET LOCAL ROLE authenticated;
DO $mute$
DECLARE v_key text := pg_catalog.current_setting('novelight.smoke.post_key');
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.novelight_community_toggle_like(v_key);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Mute bypassed through like RPC'; END IF;
END
$mute$;

RESET ROLE;
DELETE FROM public.user_mutes
 WHERE muter_user_id = pg_catalog.current_setting('novelight.smoke.reader')::uuid
   AND muted_user_id = pg_catalog.current_setting('novelight.smoke.author')::uuid;
INSERT INTO public.community_hidden_posts(post_key, reason)
VALUES (
  pg_catalog.current_setting('novelight.smoke.post_key'),
  'Staging-only hidden-post proof'
);
SET LOCAL ROLE authenticated;
DO $hidden$
DECLARE v_key text := pg_catalog.current_setting('novelight.smoke.post_key');
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.novelight_community_toggle_like(v_key);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Hidden post still interactive'; END IF;
  IF pg_catalog.jsonb_array_length(
     public.novelight_community_comments(v_key,20)
  ) <> 0 THEN RAISE EXCEPTION 'Hidden-post comments leaked'; END IF;
END
$hidden$;
RESET ROLE;

-- A successful run still discards EVERY fixture and the transient gate ON.
ROLLBACK;
\echo 'COMMUNITY_STAGING_INTERACTIONS_ROLLBACK_OK'
