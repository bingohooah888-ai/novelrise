-- Trusted-main read-only reconciliation of ALL Point-related Staging records.
-- Never use in a write transaction, and never surface row data or user IDs in logs.
-- If any referenced table/function is absent, fail closed.
SELECT 'scout_point_ledger' AS surface,
  count(*)::bigint AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text),'')) AS fingerprint
FROM public.scout_point_ledger AS t;
SELECT 'scout_badge_definitions' AS surface,
  count(*)::bigint AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.badge_id),'')) AS fingerprint
FROM public.scout_badge_definitions AS t;
SELECT 'user_scout_badges' AS surface,
  count(*)::bigint AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.user_id::text,t.badge_id),'')) AS fingerprint
FROM public.user_scout_badges AS t;
SELECT 'scout_point_operator_actions' AS surface,
  count(*)::bigint AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text),'')) AS fingerprint
FROM public.scout_point_operator_actions AS t;
SELECT 'scout_xp_ledger' AS surface,
  count(*)::bigint AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text),'')) AS fingerprint
FROM public.scout_xp_ledger AS t;
SELECT 'novelight_award_level_up_points' AS surface,
  1::bigint AS rows,
  md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure)) AS fingerprint;
