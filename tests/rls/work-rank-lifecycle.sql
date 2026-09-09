\set ON_ERROR_STOP on

-- Raw lifecycle history stays hidden; authors operate through narrowly scoped RPCs.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform count(*) from public.novel_final_rank_history;
    raise exception 'authenticated author unexpectedly read raw FINAL RANK history';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- A different authenticated user cannot inspect or mutate another author's state.
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  begin
    perform public.novelight_work_completion_status(
      '10000000-0000-0000-0000-000000000001'
    );
    raise exception 'non-owner unexpectedly read completion status';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.novelight_set_work_completion_status(
      '10000000-0000-0000-0000-000000000001',
      true
    );
    raise exception 'non-owner unexpectedly changed completion status';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;
reset role;

-- The first ongoing -> completed transition is free and idempotent.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.novelight_set_work_completion_status(
  '10000000-0000-0000-0000-000000000001',
  true
);
select public.novelight_set_work_completion_status(
  '10000000-0000-0000-0000-000000000001',
  true
);
reset role;

select public.test_assert(
  (
    select is_completed
       and completion_ever_recorded
       and completion_cycle = 1
       and completion_state_changes_used = 0
       and completed_at is not null
      from public.novel_rank_state
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  'first completion must not consume either of the two later state changes'
);

select public.test_assert(
  (
    select count(*) = 1
      from public.scout_event_ledger
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and event_type = 'work_completion_changed'
  ),
  'idempotent first completion must write exactly one replayable event'
);

-- Keep the test clock monotonic. Backdate only the fixture completion timestamp,
-- then evaluate at 29 completed days and finally at the current wall clock.
update public.novel_rank_state
   set completed_at = now() - interval '31 days'
 where novel_id_snapshot = '10000000-0000-0000-0000-000000000001';

-- A completed work still receives the 30-day reader-response grace window.
set role service_role;
select public.novelight_recalculate_work_ranks(now() - interval '2 days');
reset role;

select public.test_assert(
  (
    select final_rank is null and finalized_at is null
      from public.novel_rank_state
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  'FINAL RANK must not be fixed before 30 completed days'
);

set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (
    select final_rank = current_rank and finalized_at is not null
      from public.novel_rank_state
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  'FINAL RANK must be fixed after the 30-day response window'
);

select public.test_assert(
  (
    select count(*) = 1
      from public.novel_final_rank_history
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and completion_cycle = 1
  ),
  'first FINAL RANK must be preserved in history'
);

select public.test_assert(
  exists (
    select 1
      from public.novel_rank_events
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and event_type = 'finalized'
  ),
  'FINAL RANK fixation must be replayable through Rank history'
);

-- Reopening consumes change #1 and supersedes, but does not erase, prior FINAL RANK.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.novelight_set_work_completion_status(
  '10000000-0000-0000-0000-000000000001',
  false
);
reset role;

select public.test_assert(
  (
    select not is_completed
       and completion_cycle = 1
       and completion_state_changes_used = 1
       and completed_at is null
       and final_rank is null
       and finalized_at is null
      from public.novel_rank_state
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  'completed -> ongoing must consume the first counted state change'
);

select public.test_assert(
  (
    select superseded_at is not null and not is_public
      from public.novel_final_rank_history
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and completion_cycle = 1
  ),
  'reopen must preserve prior FINAL RANK as hidden history'
);

-- The author may explicitly publish a superseded FINAL RANK history entry.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.novelight_set_past_final_rank_public(
  '10000000-0000-0000-0000-000000000001',
  1::smallint,
  true
);
reset role;

select public.test_assert(
  (
    select is_public
      from public.novel_final_rank_history
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and completion_cycle = 1
  ),
  'author must be able to opt a past FINAL RANK into publication'
);

-- Re-completion consumes change #2. After that, further state changes are locked.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.novelight_set_work_completion_status(
  '10000000-0000-0000-0000-000000000001',
  true
);
reset role;

select public.test_assert(
  (
    select is_completed
       and completion_cycle = 2
       and completion_state_changes_used = 2
      from public.novel_rank_state
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  'ongoing -> completed after reopen must consume the second counted state change'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform public.novelight_set_work_completion_status(
      '10000000-0000-0000-0000-000000000001',
      false
    );
    raise exception 'completion state unexpectedly changed after lifetime limit';
  exception
    when sqlstate 'P0001' then null;
  end;
end
$$;
reset role;

-- Backdate the second completion as fixture data so its FINAL RANK can be
-- evaluated without advancing the evaluator beyond the real wall clock.
update public.novel_rank_state
   set completed_at = now() - interval '31 days'
 where novel_id_snapshot = '10000000-0000-0000-0000-000000000001';

set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (
    select count(*) = 2
      from public.novel_final_rank_history
     where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
  ),
  're-completion must produce a new current FINAL RANK history cycle'
);

-- Incomplete works become dormant at 30 days, lose one Rank at 60 days, then
-- one additional Rank for each further 60-day block without episode updates.
update public.novel_rank_state
   set current_rank = 4,
       peak_rank = greatest(peak_rank, 4),
       candidate_rank = 4,
       candidate_rank_since = now() - interval '181 days',
       completion_ever_recorded = false,
       completion_cycle = 0,
       completion_state_changes_used = 0,
       is_completed = false,
       completed_at = null,
       final_rank = null,
       finalized_at = null,
       dormant_since = null,
       inactivity_demotions_applied = 0,
       last_inactivity_demotion_at = null
 where novel_id_snapshot = '20000000-0000-0000-0000-000000000001';

update public.episodes
   set updated_at = now() - interval '181 days'
 where novel_id::text = '20000000-0000-0000-0000-000000000001'
   and status = 'published';

-- Evaluate a historical point 121 days after the last episode update.
set role service_role;
select public.novelight_recalculate_work_ranks(now() - interval '60 days');
reset role;

select public.test_assert(
  (
    select current_rank = 2
       and peak_rank >= 4
       and dormant_since is not null
       and inactivity_demotions_applied = 2
      from public.novel_rank_state
     where novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  '121 inactive days must apply exactly two 60-day Rank degradations'
);

-- Re-running within the same 60-day block is idempotent.
set role service_role;
select public.novelight_recalculate_work_ranks(now() - interval '59 days');
reset role;

select public.test_assert(
  (
    select current_rank = 2 and inactivity_demotions_applied = 2
      from public.novel_rank_state
     where novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  'repeated lifecycle evaluation must not double-apply inactivity degradation'
);

-- At the current wall clock 181 inactive days have elapsed, so only the third
-- 60-day degradation remains to be applied.
set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (
    select current_rank = 1 and inactivity_demotions_applied = 3
      from public.novel_rank_state
     where novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  'the next 60-day block must apply one additional Rank degradation with EMBER floor'
);

-- Publishing a fresh episode/update resumes active participation but never
-- restores the pre-dormancy Rank automatically.
update public.episodes
   set updated_at = now()
 where novel_id::text = '20000000-0000-0000-0000-000000000001'
   and status = 'published';

set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (
    select current_rank = 1
       and dormant_since is null
       and inactivity_demotions_applied = 0
       and last_inactivity_demotion_at is null
      from public.novel_rank_state
     where novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  'resumed work must return to active lifecycle without automatic Rank restoration'
);

-- Clients still cannot invoke the global evaluator after lifecycle extension.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform public.novelight_recalculate_work_ranks(now());
    raise exception 'authenticated client unexpectedly invoked global Rank evaluator';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;
