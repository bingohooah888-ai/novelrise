-- NOVELIGHT 第1回 星灯祭: 12/1以降の最終賞金候補 READ-ONLY PREVIEW.
-- This SELECT never inserts awards, sends messages, moves money or changes status.
-- Run only in an authenticated operator/admin SQL session after contest close.
-- Results are PRIVATE. Do not paste into public issues, chats or X.
-- The preview is not a final adjudication: human risk/eligibility review is required.
-- Deliberately reads ALL eligible entries, not the interim top-10 snapshot.
-- Fail-closed: returns NO ROWS before the official end time, or unless
-- status is active/review/finalized and public_visible=true. Also blocks on any
-- unresolved reader review_hold. No row == not ready OR no winners; check gates first.
WITH contest AS (
  SELECT id, starts_at, ends_at, minimum_published_episodes,
         award_rank_limit, award_amount_yen
  FROM public.novelight_contests
  WHERE contest_key = 'novelight-november-2026'
    AND status IN ('active','review','finalized')
    AND public_visible IS TRUE
    AND ends_at <= pg_catalog.clock_timestamp()
),
clear_to_preview AS (
  SELECT c.*
  FROM contest c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.novelight_contest_readers r
    WHERE r.contest_id = c.id AND r.review_status = 'review_hold'
  )
),
eligible AS MATERIALIZED (
  SELECT e.id AS entry_id, e.contest_id, e.novel_id, e.author_id
  FROM clear_to_preview c
  JOIN public.novelight_contest_entries e
    ON e.contest_id = c.id AND e.status = 'entered'
  JOIN public.novels n
    ON n.id = e.novel_id AND n.status = 'published'
  WHERE n.content_rating IN ('general','sensitive_15','mature')
    AND n.ai_usage IN ('human','ai_assisted')
    AND (
      SELECT pg_catalog.count(*) FROM public.episodes ep
      WHERE ep.novel_id = e.novel_id AND ep.status = 'published'
    ) >= c.minimum_published_episodes
),
per_reader AS (
  SELECT ev.entry_id, ev.reader_id,
         pg_catalog.count(DISTINCT ev.episode_id_snapshot)::integer AS chapters,
         coalesce(pg_catalog.sum(ev.body_char_count),0)::bigint AS body_chars
  FROM clear_to_preview c
  JOIN public.novelight_contest_read_events ev ON ev.contest_id = c.id
  JOIN eligible en ON en.entry_id = ev.entry_id
  JOIN public.novelight_contest_readers reader
    ON reader.id = ev.reader_id AND reader.contest_id = c.id
  WHERE ev.status IN ('provisional','accepted')
    AND ev.body_char_count >= 200
    AND ev.qualified_at >= c.starts_at
    AND ev.qualified_at < c.ends_at
    AND reader.review_status IN ('provisional','cleared')
    AND NOT (reader.kind = 'account' AND reader.user_id = en.author_id)
  GROUP BY ev.entry_id, ev.reader_id
),
work_points AS (
  SELECT entry_id,
         coalesce(pg_catalog.sum(
           public.novelight_contest_episode_points(chapters,body_chars)
         ),0)::bigint AS points,
         pg_catalog.count(*) FILTER (
           WHERE public.novelight_contest_episode_points(chapters,body_chars)>0
         )::integer AS qualifying_readers
  FROM per_reader
  GROUP BY entry_id
),
ranked AS (
  SELECT en.entry_id,en.novel_id,
         coalesce(wp.points,0)::bigint AS points,
         coalesce(wp.qualifying_readers,0)::integer AS qualifying_readers,
         pg_catalog.rank() OVER (
           ORDER BY coalesce(wp.points,0) DESC
         )::integer AS final_rank
  FROM eligible en LEFT JOIN work_points wp ON wp.entry_id=en.entry_id
)
SELECT r.entry_id,r.novel_id,r.final_rank,r.points,r.qualifying_readers,
       c.award_amount_yen AS expected_amount_yen
FROM ranked r CROSS JOIN clear_to_preview c
WHERE r.points >= 1 AND r.final_rank <= c.award_rank_limit
ORDER BY r.final_rank ASC,r.entry_id ASC;
