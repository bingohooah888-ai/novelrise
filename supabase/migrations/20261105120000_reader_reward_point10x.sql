-- NOVELIGHT βPoint x10: candidate-only data conversion rehearsal.
-- This file is NOT approved for persistent application anywhere.
-- A direct migration replay without the prior guarded precheck is a NO-OP.
-- The trusted-main workflow extracts this body and replaces COMMIT with ROLLBACK.
-- It does NOT change writer RPCs; it is never a complete cutover.
BEGIN;

UPDATE public.scout_point_ledger
  SET point_value = (point_value::bigint * 10)::integer
  WHERE current_setting('novelight.point10x_rollback_proof',true) = 'rollback-only';
UPDATE public.scout_badge_definitions
  SET point_reward = (point_reward::bigint * 10)::integer
  WHERE current_setting('novelight.point10x_rollback_proof',true) = 'rollback-only';
UPDATE public.scout_badge_definitions
  SET target_value = target_value * 10::bigint
  WHERE metric_key = 'scout_point_earned_total'
    AND current_setting('novelight.point10x_rollback_proof',true) = 'rollback-only';
UPDATE public.user_scout_badges
  SET progress_value = progress_value * 10::bigint
  WHERE badge_id IN ('reader_point_100', 'reader_point_500')
    AND current_setting('novelight.point10x_rollback_proof',true) = 'rollback-only';
UPDATE public.scout_point_operator_actions
  SET amount = (amount::bigint * 10)::integer
  WHERE amount IS NOT NULL
    AND current_setting('novelight.point10x_rollback_proof',true) = 'rollback-only';

COMMIT;
