-- NOVELIGHT PR #2762: scoped historical Point x10 read-only proposal.
-- THIS IS A SELECT, NOT A MIGRATION; DO NOT UPDATE ANY TABLE.
-- Uses existing canonical Point entries; does not establish Auth provenance.
-- Old badge 1-Point entries: old 3581 -> projected 35810 only if all are valid.
-- Future rewards were already scaled by migration 20261109173000.
WITH ledger AS (
  SELECT
    count(*)::bigint AS ledger_rows,
    count(DISTINCT p.user_id)::bigint AS ledger_users,
    count(DISTINCT p.user_id) FILTER (WHERE a.id IS NOT NULL)::bigint AS auth_matched_users,
    count(DISTINCT p.user_id) FILTER (WHERE a.id IS NULL)::bigint AS auth_unmatched_users,
    count(*) FILTER (WHERE p.point_kind='badge' AND p.point_value=1
      AND p.status='confirmed')::bigint AS old_badge_rows,
    coalesce(sum(p.point_value) FILTER (WHERE p.point_kind='badge'
      AND p.point_value=1 AND p.status='confirmed'),0)::bigint AS old_badge_points,
    coalesce(sum(p.point_value) FILTER (WHERE p.status='confirmed'),0)::bigint AS confirmed_net,
    count(*) FILTER (WHERE p.status<>'confirmed')::bigint AS unresolved_rows,
    count(*) FILTER (WHERE p.reversal_of IS NOT NULL)::bigint AS reversal_rows
  FROM public.scout_point_ledger p
  LEFT JOIN auth.users a ON a.id=p.user_id
)
SELECT *, old_badge_points*10 AS projected_badge_points,
  confirmed_net+old_badge_points*9 AS projected_total_points,
  CASE WHEN auth_unmatched_users>0 THEN 'HOLD_IDENTITY_PROVENANCE'
    WHEN unresolved_rows>0 OR reversal_rows>0 THEN 'HOLD_UNSETTLED'
    ELSE 'QUOTE_ONLY_NO_MUTATION_APPROVAL' END AS decision
FROM ledger;
