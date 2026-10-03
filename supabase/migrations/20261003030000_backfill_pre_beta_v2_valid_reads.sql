-- Backfill the 13 pre-beta-v2 read sessions that were proven eligible by the
-- historical reader_reading_progress + valid_read_sessions contract.
--
-- Safety properties:
--   * fixed session allowlist: the broad 18-session query must never drive writes
--   * current published novel/episode required
--   * own-work reads excluded
--   * reader_reading_progress is the historical progress source of truth
--   * beta-v2 foreground/progress thresholds are revalidated at apply time
--   * only sessions that failed the old 60-second foreground rule are in scope
--   * reader/episode lifetime uniqueness is preserved
--   * Scout XP is awarded only through the existing scout_event_ledger trigger
--   * all writes are idempotent

DO $$
DECLARE
  v_rule public.valid_read_rules%ROWTYPE;
  v_target_count integer;
BEGIN
  SELECT * INTO v_rule
  FROM public.valid_read_rules
  WHERE id = 1;

  IF NOT FOUND
     OR v_rule.rule_version <> 'beta-v2'
     OR v_rule.normal_min_chars <> 800
     OR v_rule.normal_progress_ratio <> 0.8
     OR v_rule.short_progress_ratio <> 0.8
     OR v_rule.normal_foreground_seconds <> 30
     OR v_rule.min_short_foreground_seconds <> 10 THEN
    RAISE EXCEPTION 'valid-read beta-v2 contract changed; refusing historical backfill';
  END IF;

  WITH target_sessions(session_id) AS (
    VALUES
      ('744d910c-0466-4ce0-8c3b-b106adfb376b'::uuid),
      ('fb0f82c2-171c-4ff6-801b-cd402072cf63'::uuid),
      ('2a2fee5a-a573-4e3a-9a27-0d1bd7dbe2b1'::uuid),
      ('1b776205-f1d1-4ed2-99dc-0ea33f94c948'::uuid),
      ('6809632b-ff27-48c1-b73f-0859382dff94'::uuid),
      ('69eee612-88f2-4e19-8fa5-d35860e95c87'::uuid),
      ('bf5e3ff8-c866-4c30-8e15-ebd79813b649'::uuid),
      ('be0f756f-08b0-4f1b-bcbc-484e194ef4be'::uuid),
      ('ba32a72b-88dc-41be-b6d4-42c8447ac3f7'::uuid),
      ('4929a143-f56f-4d54-a455-7e998ade36cc'::uuid),
      ('02e71f8f-2682-4796-bfba-c6aed9aedbaf'::uuid),
      ('40ea614f-1c83-466d-a344-edf566426a4a'::uuid),
      ('6175e5d3-c05c-4634-bf89-d1b5fe7eec4c'::uuid)
  )
  SELECT count(*) INTO v_target_count
  FROM target_sessions t
  JOIN public.valid_read_sessions s ON s.session_id = t.session_id;

  IF v_target_count <> 13 THEN
    RAISE EXCEPTION 'historical valid-read target set drifted: expected 13 sessions, found %', v_target_count;
  END IF;
END
$$;

WITH target_sessions(session_id) AS (
  VALUES
    ('744d910c-0466-4ce0-8c3b-b106adfb376b'::uuid),
    ('fb0f82c2-171c-4ff6-801b-cd402072cf63'::uuid),
    ('2a2fee5a-a573-4e3a-9a27-0d1bd7dbe2b1'::uuid),
    ('1b776205-f1d1-4ed2-99dc-0ea33f94c948'::uuid),
    ('6809632b-ff27-48c1-b73f-0859382dff94'::uuid),
    ('69eee612-88f2-4e19-8fa5-d35860e95c87'::uuid),
    ('bf5e3ff8-c866-4c30-8e15-ebd79813b649'::uuid),
    ('be0f756f-08b0-4f1b-bcbc-484e194ef4be'::uuid),
    ('ba32a72b-88dc-41be-b6d4-42c8447ac3f7'::uuid),
    ('4929a143-f56f-4d54-a455-7e998ade36cc'::uuid),
    ('02e71f8f-2682-4796-bfba-c6aed9aedbaf'::uuid),
    ('40ea614f-1c83-466d-a344-edf566426a4a'::uuid),
    ('6175e5d3-c05c-4634-bf89-d1b5fe7eec4c'::uuid)
),
eligible AS (
  SELECT
    s.reader_id,
    s.session_id,
    s.novel_id_snapshot,
    s.episode_id_snapshot,
    s.author_id_snapshot,
    s.body_char_count,
    s.interaction_count,
    s.started_at,
    s.last_heartbeat_at,
    r.interaction_events,
    r.rule_version
  FROM target_sessions t
  JOIN public.valid_read_sessions s ON s.session_id = t.session_id
  JOIN public.episodes e
    ON e.id::text = s.episode_id_snapshot
   AND e.novel_id::text = s.novel_id_snapshot
  JOIN public.novels n ON n.id::text = s.novel_id_snapshot
  JOIN public.reader_reading_progress rp
    ON rp.user_id = s.reader_id
   AND rp.novel_id::text = s.novel_id_snapshot
   AND rp.episode_id::text = s.episode_id_snapshot
  CROSS JOIN public.valid_read_rules r
  WHERE r.id = 1
    AND r.rule_version = 'beta-v2'
    AND s.started_at < r.updated_at
    AND s.qualified_at IS NULL
    AND e.status = 'published'
    AND n.status = 'published'
    AND s.author_id_snapshot = n.user_id
    AND s.reader_id <> n.user_id
    AND rp.progress_ratio >= CASE
      WHEN s.body_char_count < r.normal_min_chars THEN r.short_progress_ratio
      ELSE r.normal_progress_ratio
    END
    AND s.foreground_seconds >= CASE
      WHEN s.body_char_count < r.normal_min_chars THEN least(
        r.normal_foreground_seconds,
        greatest(
          r.min_short_foreground_seconds,
          ceil(
            r.normal_foreground_seconds::numeric
            * greatest(s.body_char_count, 1)::numeric
            / r.normal_min_chars::numeric
          )::integer
        )
      )
      ELSE r.normal_foreground_seconds
    END
    AND s.foreground_seconds < 60
)
INSERT INTO public.valid_read_events (
  reader_id,
  novel_id_snapshot,
  episode_id_snapshot,
  author_id_snapshot,
  session_id,
  qualified_at,
  body_char_count,
  progress_signal,
  foreground_signal,
  interaction_signal,
  rule_version
)
SELECT
  e.reader_id,
  e.novel_id_snapshot,
  e.episode_id_snapshot,
  e.author_id_snapshot,
  e.session_id,
  e.last_heartbeat_at,
  e.body_char_count,
  true,
  true,
  e.interaction_count >= e.interaction_events,
  e.rule_version
FROM eligible e
ON CONFLICT (reader_id, episode_id_snapshot) DO NOTHING;

-- Mark only the exact historical session that owns the inserted/existing event.
WITH target_sessions(session_id) AS (
  VALUES
    ('744d910c-0466-4ce0-8c3b-b106adfb376b'::uuid),
    ('fb0f82c2-171c-4ff6-801b-cd402072cf63'::uuid),
    ('2a2fee5a-a573-4e3a-9a27-0d1bd7dbe2b1'::uuid),
    ('1b776205-f1d1-4ed2-99dc-0ea33f94c948'::uuid),
    ('6809632b-ff27-48c1-b73f-0859382dff94'::uuid),
    ('69eee612-88f2-4e19-8fa5-d35860e95c87'::uuid),
    ('bf5e3ff8-c866-4c30-8e15-ebd79813b649'::uuid),
    ('be0f756f-08b0-4f1b-bcbc-484e194ef4be'::uuid),
    ('ba32a72b-88dc-41be-b6d4-42c8447ac3f7'::uuid),
    ('4929a143-f56f-4d54-a455-7e998ade36cc'::uuid),
    ('02e71f8f-2682-4796-bfba-c6aed9aedbaf'::uuid),
    ('40ea614f-1c83-466d-a344-edf566426a4a'::uuid),
    ('6175e5d3-c05c-4634-bf89-d1b5fe7eec4c'::uuid)
)
UPDATE public.valid_read_sessions s
SET qualified_at = v.qualified_at
FROM target_sessions t
JOIN public.valid_read_events v ON v.session_id = t.session_id
WHERE s.session_id = t.session_id
  AND s.reader_id = v.reader_id
  AND s.episode_id_snapshot = v.episode_id_snapshot
  AND s.qualified_at IS NULL;

-- Mirror record_valid_read_progress(): the existing ledger trigger is the only
-- path that may award Scout XP, so no direct scout_xp_ledger write is performed.
WITH target_sessions(session_id) AS (
  VALUES
    ('744d910c-0466-4ce0-8c3b-b106adfb376b'::uuid),
    ('fb0f82c2-171c-4ff6-801b-cd402072cf63'::uuid),
    ('2a2fee5a-a573-4e3a-9a27-0d1bd7dbe2b1'::uuid),
    ('1b776205-f1d1-4ed2-99dc-0ea33f94c948'::uuid),
    ('6809632b-ff27-48c1-b73f-0859382dff94'::uuid),
    ('69eee612-88f2-4e19-8fa5-d35860e95c87'::uuid),
    ('bf5e3ff8-c866-4c30-8e15-ebd79813b649'::uuid),
    ('be0f756f-08b0-4f1b-bcbc-484e194ef4be'::uuid),
    ('ba32a72b-88dc-41be-b6d4-42c8447ac3f7'::uuid),
    ('4929a143-f56f-4d54-a455-7e998ade36cc'::uuid),
    ('02e71f8f-2682-4796-bfba-c6aed9aedbaf'::uuid),
    ('40ea614f-1c83-466d-a344-edf566426a4a'::uuid),
    ('6175e5d3-c05c-4634-bf89-d1b5fe7eec4c'::uuid)
)
INSERT INTO public.scout_event_ledger (
  user_id,
  event_type,
  event_key,
  novel_id_snapshot,
  episode_id_snapshot,
  occurred_at,
  metadata
)
SELECT
  v.reader_id,
  'valid_read',
  'valid_read:' || v.reader_id::text || ':' || v.episode_id_snapshot,
  v.novel_id_snapshot,
  v.episode_id_snapshot,
  v.qualified_at,
  jsonb_build_object(
    'valid_read_event_id', v.id,
    'rule_version', v.rule_version,
    'historical_backfill', 'pre-beta-v2-tts'
  )
FROM target_sessions t
JOIN public.valid_read_events v ON v.session_id = t.session_id
JOIN public.valid_read_sessions s
  ON s.reader_id = v.reader_id
 AND s.session_id = v.session_id
 AND s.episode_id_snapshot = v.episode_id_snapshot
JOIN public.episodes e
  ON e.id::text = v.episode_id_snapshot
 AND e.novel_id::text = v.novel_id_snapshot
JOIN public.novels n ON n.id::text = v.novel_id_snapshot
WHERE e.status = 'published'
  AND n.status = 'published'
  AND v.reader_id <> n.user_id
ON CONFLICT (event_key) DO NOTHING;
