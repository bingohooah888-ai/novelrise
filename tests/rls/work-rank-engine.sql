\set ON_ERROR_STOP on

-- Individual rating rows stay hidden from clients.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  begin
    perform count(*) from public.novel_star_ratings;
    raise exception 'authenticated reader unexpectedly read raw star ratings';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Authors cannot rate their own work.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform public.set_novel_star_rating(
      '10000000-0000-0000-0000-000000000001',
      5
    );
    raise exception 'author unexpectedly rated own work';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;
reset role;

-- First rating writes one replayable event. Repeating the exact same value is
-- idempotent; changing it records a separate history event.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.set_novel_star_rating(
  '10000000-0000-0000-0000-000000000001',
  5
);
select public.set_novel_star_rating(
  '10000000-0000-0000-0000-000000000001',
  5
);
reset role;

select public.test_assert(
  (select count(*) = 1
     from public.scout_event_ledger e
    where e.user_id = '33333333-3333-3333-3333-333333333333'
      and e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
      and e.event_type = 'star_rating_set'),
  'same-value rating retry must not duplicate history'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.set_novel_star_rating(
  '10000000-0000-0000-0000-000000000001',
  4
);
reset role;

select public.test_assert(
  (select count(*) = 1
     from public.scout_event_ledger e
    where e.user_id = '33333333-3333-3333-3333-333333333333'
      and e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
      and e.event_type = 'star_rating_changed'),
  'rating change must be preserved as replayable history'
);

-- A second independent reader establishes the Rank 2 minimum rating count.
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.set_novel_star_rating(
  '10000000-0000-0000-0000-000000000001',
  4
);
reset role;

select public.test_assert(
  (public.novelight_star_rating_status(
    '10000000-0000-0000-0000-000000000001'
  )->>'rating_count')::integer = 2,
  'rating status must report two independent raters'
);

select public.test_assert(
  (public.novelight_star_rating_status(
    '10000000-0000-0000-0000-000000000001'
  )->>'average_rating')::numeric = 4.00,
  'rating status must report current average only'
);

-- MASTER Chapter 38 absolute thresholds are pinned independently of the batch
-- evaluator so future score tuning cannot silently move the eligibility floor.
select public.test_assert(
  public.novelight_rank_absolute_ceiling_v2(50, 2, 2, 3.0) = 2,
  'Rank 2 valid-read threshold must match MASTER'
);
select public.test_assert(
  public.novelight_rank_absolute_ceiling_v2(199, 8, 5, 3.3) = 2,
  'Rank 3 requires 200 qualified reads even when other metrics qualify'
);
select public.test_assert(
  public.novelight_rank_required_stability(6::smallint) = interval '7 days',
  'NOVA promotion requires seven stable days'
);

-- A spoofed raw PV spike must not change Rank eligibility.
update public.novels
set pv = 1000000
where id::text = '10000000-0000-0000-0000-000000000001';

insert into public.favorites (user_id, novel_id)
select '33333333-3333-3333-3333-333333333333', n.id
from public.novels n
where n.id::text = '10000000-0000-0000-0000-000000000001'
  and not exists (
    select 1 from public.favorites f
    where f.user_id = '33333333-3333-3333-3333-333333333333'
      and f.novel_id::text = n.id::text
  );

insert into public.favorites (user_id, novel_id)
select '44444444-4444-4444-4444-444444444444', n.id
from public.novels n
where n.id::text = '10000000-0000-0000-0000-000000000001'
  and not exists (
    select 1 from public.favorites f
    where f.user_id = '44444444-4444-4444-4444-444444444444'
      and f.novel_id::text = n.id::text
  );

set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (select current_rank = 1 and candidate_rank = 1
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'raw PV inflation alone must not raise the Rank candidate'
);

-- Fifty independently qualified reader/episode events satisfy the Rank 2
-- readership floor. The events are inserted directly only as deterministic
-- service-role fixtures; production clients cannot write this table.
insert into public.valid_read_events (
  reader_id,
  novel_id_snapshot,
  episode_id_snapshot,
  author_id_snapshot,
  session_id,
  body_char_count,
  progress_signal,
  foreground_signal,
  interaction_signal,
  rule_version
)
select
  gen_random_uuid(),
  '10000000-0000-0000-0000-000000000001',
  'rank-fixture-episode',
  '11111111-1111-1111-1111-111111111111',
  gen_random_uuid(),
  1000,
  true,
  true,
  false,
  'rank-fairness-test'
from generate_series(1, 50);

-- Clients cannot run the global Rank evaluator.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  begin
    perform public.novelight_recalculate_work_ranks(now());
    raise exception 'authenticated client unexpectedly recalculated global Rank';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- First qualifying evaluation starts the 24h SPARK stability clock but does not
-- immediately promote.
set role service_role;
select public.novelight_recalculate_work_ranks(now());
reset role;

select public.test_assert(
  (select current_rank = 1 and candidate_rank = 2
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'Rank 2 candidate must wait before promotion'
);

set role service_role;
select public.novelight_recalculate_work_ranks(now() + interval '23 hours');
reset role;

select public.test_assert(
  (select current_rank = 1
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  '23 hours must not satisfy the 24h SPARK stability window'
);

set role service_role;
select public.novelight_recalculate_work_ranks(now() + interval '25 hours');
reset role;

select public.test_assert(
  (select current_rank = 2 and peak_rank = 2
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'stable Rank 2 eligibility must promote to SPARK and preserve peak Rank'
);

select public.test_assert(
  exists (
    select 1 from public.novel_rank_events e
    where e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
      and e.from_rank = 1 and e.to_rank = 2 and e.event_type = 'promotion'
  ),
  'promotion must use the existing replayable Rank event path'
);

-- Drop below the absolute Rank 2 floor. Active-work metric demotion is immediate;
-- the separate 30/60-day inactivity lifecycle is intentionally a later PR.
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.clear_novel_star_rating(
  '10000000-0000-0000-0000-000000000001'
);
reset role;

delete from public.favorites
where user_id = '44444444-4444-4444-4444-444444444444'
  and novel_id::text = '10000000-0000-0000-0000-000000000001';

set role service_role;
select public.novelight_recalculate_work_ranks(now() + interval '26 hours');
reset role;

select public.test_assert(
  (select current_rank = 1 and peak_rank = 2
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'falling below active Rank requirements must demote without erasing peak Rank'
);

select public.test_assert(
  exists (
    select 1 from public.novel_rank_events e
    where e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
      and e.from_rank = 2 and e.to_rank = 1 and e.event_type = 'demotion'
  ),
  'demotion must use the existing replayable Rank event path'
);

-- Existing LIGHT SEED evidence may remain on the work, but Rank has returned to
-- EMBER because the evaluator never reads seed counts or seed type.
select public.test_assert(
  (select current_rank = 1
     from public.novel_rank_state
    where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'LIGHT SEED evidence must not keep a work above its earned Rank'
);
