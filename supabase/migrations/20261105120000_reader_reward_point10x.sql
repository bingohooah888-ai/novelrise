-- NOVELIGHT βPoint x10: candidate-only data conversion rehearsal.
-- This file is not approved for persistent application anywhere.
-- The trusted-main workflow extracts this body and replaces COMMIT with ROLLBACK.
-- It does NOT change writer RPCs; it is never a complete cutover.
BEGIN;

UPDATE public.scout_point_ledger
  SET point_value = (point_value::bigint * 10)::integer;
UPDATE public.scout_badge_definitions
  SET point_reward = (point_reward::bigint * 10)::integer;
UPDATE public.scout_badge_definitions
  SET target_value = target_value * 10::bigint
  WHERE metric_key = 'scout_point_earned_total';
UPDATE public.user_scout_badges
  SET progress_value = progress_value * 10::bigint
  WHERE badge_id IN ('reader_point_100', 'reader_point_500');
UPDATE public.scout_point_operator_actions
  SET amount = (amount::bigint * 10)::integer
  WHERE amount IS NOT NULL;

COMMIT;
