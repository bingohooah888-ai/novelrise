-- Stage 10: READ-ONLY synthetic acceptance checks. No table writes, no Production contest activation.
-- Execute SELECT statements only in a trusted, read-only SQL client.
-- These fixtures prove PostgreSQL rank/tie boundaries; they do NOT finalize awards
-- or prove a production final-award operator flow.
--
-- Expected: 4 rows, all pass=true. The all_tied scenario must have
-- winners_beyond_public_top10=2; final awards MUST NOT use the interim top-10 snapshot.
WITH fixture(case_id, work_id, points) AS (
  VALUES
    ('fifth_tie','a',15),('fifth_tie','b',12),('fifth_tie','c',9),
    ('fifth_tie','d',6),('fifth_tie','e',3),('fifth_tie','f',3),
    ('fifth_tie','g',3),('fifth_tie','h',1),('fifth_tie','i',0),
    ('all_tied','a',1),('all_tied','b',1),('all_tied','c',1),
    ('all_tied','d',1),('all_tied','e',1),('all_tied','f',1),
    ('all_tied','g',1),('all_tied','h',1),('all_tied','i',1),
    ('all_tied','j',1),('all_tied','k',1),('all_tied','l',1),
    ('zero_only','a',0),('zero_only','b',0),('zero_only','c',0),
    ('skipped_ranks','a',15),('skipped_ranks','b',15),
    ('skipped_ranks','c',12),('skipped_ranks','d',9),
    ('skipped_ranks','e',3),('skipped_ranks','f',3),
    ('skipped_ranks','g',1)
), ranked AS (
  SELECT case_id, work_id, points,
         rank() OVER (PARTITION BY case_id ORDER BY points DESC) AS ordinal_rank,
         row_number() OVER (
           PARTITION BY case_id ORDER BY points DESC, work_id
         ) AS position
  FROM fixture
), actual AS (
  SELECT case_id,
         count(*) FILTER (WHERE ordinal_rank <= 5 AND points >= 1) AS winners,
         count(*) FILTER (
           WHERE ordinal_rank <= 5 AND points >= 1 AND position > 10
         ) AS winners_beyond_public_top10,
         coalesce(max(ordinal_rank) FILTER (
           WHERE ordinal_rank <= 5 AND points >= 1
         ), 0) AS max_winning_rank
  FROM ranked
  GROUP BY case_id
), expected(case_id, winners, beyond_top10, max_rank) AS (
  VALUES
    ('fifth_tie',7,0,5),
    ('all_tied',12,2,1),
    ('zero_only',0,0,0),
    ('skipped_ranks',6,0,5)
)
SELECT a.case_id, a.winners,
       a.winners_beyond_public_top10, a.max_winning_rank,
       (a.winners = e.winners
        AND a.winners_beyond_public_top10 = e.beyond_top10
        AND a.max_winning_rank = e.max_rank) AS pass
FROM actual a JOIN expected e USING (case_id)
ORDER BY a.case_id;

-- Expected: 8 rows, all pass=true. Calls existing server-side scoring function.
-- The call requires an authorized administrative SQL role.
WITH cases(episodes, body_chars, expected) AS (
  VALUES
    (2,6000,0), (3,1499,0), (3,1500,1), (5,2999,1),
    (5,3000,3), (10,5999,3), (10,6000,5), (12,99999,5)
)
SELECT episodes, body_chars, expected,
       public.novelight_contest_episode_points(
         episodes, body_chars::bigint
       ) AS actual,
       (public.novelight_contest_episode_points(
         episodes, body_chars::bigint
       ) = expected) AS pass
FROM cases;

-- Expected: 3 rows, all pass=true. 03:00 UTC = 12:00 JST.
WITH expected(slot, expected_time) AS (
  VALUES
    (1,'2026-11-07 03:00:00+00'::timestamptz),
    (2,'2026-11-15 03:00:00+00'::timestamptz),
    (3,'2026-11-22 03:00:00+00'::timestamptz)
)
SELECT slot, public.novelight_contest_rank_slot_at(slot) AS actual,
       expected_time,
       (public.novelight_contest_rank_slot_at(slot) = expected_time) AS pass
FROM expected
ORDER BY slot;
