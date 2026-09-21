\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_user uuid := 'bd000000-0000-4000-8000-000000000001';
  v_eval jsonb;
  v_points bigint;
  v_badges bigint;
begin
  v_eval := public.novelight_evaluate_scout_badge(
    'reader_read_010',
    '{"valid_read_work_count":7}'::jsonb
  );

  if (v_eval->>'progress_value')::bigint <> 7
     or (v_eval->>'progress_percent')::numeric <> 70
     or (v_eval->>'earned')::boolean then
    raise exception 'Threshold Badge progress evaluator drifted: %', v_eval;
  end if;

  v_eval := public.novelight_evaluate_scout_badge(
    'reader_master_scout',
    '{
      "discovery_plus5_count":10,
      "nova_prediction_count":5,
      "new_author_read_count":50,
      "genre_count":10
    }'::jsonb
  );

  if (v_eval->>'progress_value')::bigint <> 2
     or (v_eval->>'progress_percent')::numeric <> 75
     or (v_eval->>'earned')::boolean
     or pg_catalog.jsonb_array_length(v_eval->'metadata'->'composite_progress') <> 4 then
    raise exception 'Composite Badge progress evaluator drifted: %', v_eval;
  end if;

  perform public.novelight_apply_scout_badge_evaluation(
    v_user, 'reader_read_001', 1, 100, true,
    '{"test":"first"}'::jsonb, true
  );
  perform public.novelight_apply_scout_badge_evaluation(
    v_user, 'reader_read_001', 1, 100, true,
    '{"test":"duplicate"}'::jsonb, true
  );

  select count(*) into v_badges
    from public.user_scout_badges
   where user_id=v_user and badge_id='reader_read_001';
  if v_badges <> 1 then
    raise exception 'Reader Badge unlock is not idempotent';
  end if;

  select coalesce(sum(point_value),0)::bigint into v_points
    from public.scout_point_ledger
   where user_id=v_user
     and point_kind='badge'
     and metadata->>'badge_id'='reader_read_001'
     and status='confirmed';
  if v_points <> 1 then
    raise exception 'Reader Easy Badge reward was not issued exactly once: %', v_points;
  end if;

  -- Recalculation below target cannot revoke a previously earned ordinary Badge.
  perform public.novelight_apply_scout_badge_evaluation(
    v_user, 'reader_read_001', 0, 0, false,
    '{"test":"recalculate"}'::jsonb, false
  );
  if not exists (
    select 1 from public.user_scout_badges
     where user_id=v_user
       and badge_id='reader_read_001'
       and status='earned'
       and progress_percent=100
  ) then
    raise exception 'Badge recalculation revoked an already-earned Badge';
  end if;

  -- Point-conditioned badges must not create Point -> Badge -> Point loops.
  perform public.novelight_apply_scout_badge_evaluation(
    v_user, 'reader_point_100', 100, 100, true, '{}'::jsonb, true
  );
  select coalesce(sum(point_value),0)::bigint into v_points
    from public.scout_point_ledger
   where user_id=v_user
     and point_kind='badge'
     and metadata->>'badge_id'='reader_point_100';
  if v_points <> 0 then
    raise exception 'Point-condition Badge created a self-reward loop';
  end if;

  -- Author badges are achievement-only and never mint Scout Point.
  perform public.novelight_apply_scout_badge_evaluation(
    v_user, 'author_novel_001', 1, 100, true, '{}'::jsonb, true
  );
  select coalesce(sum(point_value),0)::bigint into v_points
    from public.scout_point_ledger
   where user_id=v_user
     and point_kind='badge'
     and metadata->>'badge_id'='author_novel_001';
  if v_points <> 0 then
    raise exception 'Author Badge unexpectedly awarded Scout Point';
  end if;

  if (
    select count(*) from public.scout_badge_definitions
     where badge_category='reader' and enabled
  ) <> 100 then
    raise exception 'Reader Badge catalog no longer contains exactly 100 enabled definitions';
  end if;

  if (
    select count(*) from public.scout_badge_definitions
     where badge_category='author' and enabled
  ) <> 40 then
    raise exception 'Author Badge catalog no longer contains exactly 40 enabled definitions';
  end if;

  if (
    select count(*) from public.scout_badge_definitions
     where badge_category='limited' and enabled
  ) <> 2 then
    raise exception 'Limited Badge category was not kept separate';
  end if;
end
$test$;

rollback;
