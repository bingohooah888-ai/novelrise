\set ON_ERROR_STOP on

begin;

create or replace function public.beta_final_test_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end
$$;

insert into auth.users (id) values
  ('fa400000-0000-4000-8000-000000000001'),
  ('fa400000-0000-4000-8000-000000000002'),
  ('fa400000-0000-4000-8000-000000000003');

update public.profiles
set display_name = case id
  when 'fa400000-0000-4000-8000-000000000001'::uuid then 'Fairness Author A'
  when 'fa400000-0000-4000-8000-000000000002'::uuid then 'Fairness Author B'
  else 'Fairness Reader'
end,
plan = 'standard'
where id in (
  'fa400000-0000-4000-8000-000000000001'::uuid,
  'fa400000-0000-4000-8000-000000000002'::uuid,
  'fa400000-0000-4000-8000-000000000003'::uuid
);

insert into public.novels (
  id, user_id, title, description, genre, status, pv,
  ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version,
  created_at, first_published_at
) values
  (
    9984001,
    'fa400000-0000-4000-8000-000000000001',
    'Fairness Search High PV',
    'audit fixture',
    'ファンタジー',
    'published',
    999999,
    'human',
    'general',
    '{}'::text[],
    true,
    'beta-v1',
    timestamptz '2026-09-10 12:00:00+09',
    timestamptz '2026-09-10 12:00:00+09'
  ),
  (
    9984002,
    'fa400000-0000-4000-8000-000000000002',
    'Fairness Search Low PV',
    'audit fixture',
    'ファンタジー',
    'published',
    1,
    'human',
    'general',
    '{}'::text[],
    true,
    'beta-v1',
    timestamptz '2026-09-11 12:00:00+09',
    timestamptz '2026-09-11 12:00:00+09'
  );

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status
) values
  (
    9984011, 9984001,
    'fa400000-0000-4000-8000-000000000001',
    1, 'Fairness episode one', repeat('本文', 600), 'published'
  ),
  (
    9984012, 9984001,
    'fa400000-0000-4000-8000-000000000001',
    2, 'Fairness episode two', repeat('本文', 600), 'published'
  );
-- Client-controlled progress + interaction alone cannot qualify on the first RPC.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'fa400000-0000-4000-8000-000000000003',
  false
);

select public.beta_final_test_assert(
  not (
    public.record_valid_read_progress(
      '9984011',
      'fa400000-0000-4000-8000-000000000011',
      1.0,
      99,
      1
    )->>'qualified'
  )::boolean,
  'first heartbeat must not qualify using only client-controlled signals'
);
reset role;

-- Foreground credit is server-clock derived. Three bounded 20-second gaps are
-- needed before the same progress/interaction payload becomes eligible.
update public.valid_read_sessions
set last_heartbeat_at = now() - interval '20 seconds'
where reader_id = 'fa400000-0000-4000-8000-000000000003'
  and session_id = 'fa400000-0000-4000-8000-000000000011';

set role authenticated;
select set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000003',false);
select public.record_valid_read_progress(
  '9984011','fa400000-0000-4000-8000-000000000011',1.0,99,2
);
reset role;
update public.valid_read_sessions
set last_heartbeat_at = now() - interval '20 seconds'
where reader_id = 'fa400000-0000-4000-8000-000000000003'
  and session_id = 'fa400000-0000-4000-8000-000000000011';

set role authenticated;
select set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000003',false);
select public.record_valid_read_progress(
  '9984011','fa400000-0000-4000-8000-000000000011',1.0,99,3
);
reset role;

update public.valid_read_sessions
set last_heartbeat_at = now() - interval '20 seconds'
where reader_id = 'fa400000-0000-4000-8000-000000000003'
  and session_id = 'fa400000-0000-4000-8000-000000000011';

set role authenticated;
select set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000003',false);
select public.beta_final_test_assert(
  (
    public.record_valid_read_progress(
      '9984011','fa400000-0000-4000-8000-000000000011',1.0,99,4
    )->>'qualified'
  )::boolean,
  'server-clock foreground plus a second signal must qualify'
);
reset role;

-- One reader qualifying multiple episodes is still one ranking reader.
insert into public.valid_read_events (
  reader_id, novel_id_snapshot, episode_id_snapshot, author_id_snapshot,
  session_id, body_char_count, progress_signal, foreground_signal,
  interaction_signal, rule_version
) values (
  'fa400000-0000-4000-8000-000000000003',
  '9984001',
  '9984012',
  'fa400000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000012',
  1200,
  true,
  true,
  false,
  'fairness-test'
);

select public.beta_final_test_assert(
  (
    select valid_read_count = 1
    from public.novelight_ranking_feed_v2('reads',100)
    where novel_id = '9984001'
  ),
  'multiple episodes from one reader must count as one ranking reader'
);
-- A second account can contribute one additional unique reader.
insert into public.valid_read_events (
  reader_id, novel_id_snapshot, episode_id_snapshot, author_id_snapshot,
  session_id, body_char_count, progress_signal, foreground_signal,
  interaction_signal, rule_version
) values (
  'fa400000-0000-4000-8000-000000000002',
  '9984001',
  '9984011',
  'fa400000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000013',
  1200,
  true,
  true,
  false,
  'fairness-test'
);

select public.beta_final_test_assert(
  (
    select valid_read_count = 2
    from public.novelight_ranking_feed_v2('reads',100)
    where novel_id = '9984001'
  ),
  'ranking must count distinct qualified readers'
);

-- The author cannot favorite their own published work through client RLS.
set role authenticated;
select set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000001',false);
do $$
begin
  begin
    insert into public.favorites (user_id, novel_id)
    values ('fa400000-0000-4000-8000-000000000001',9984001);
    raise exception 'author unexpectedly favorited own work';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;
reset role;

-- A real reader favorite is accepted.
set role authenticated;
select set_config('request.jwt.claim.sub','fa400000-0000-4000-8000-000000000003',false);
insert into public.favorites (user_id, novel_id)
values ('fa400000-0000-4000-8000-000000000003',9984001);
reset role;

-- Simulate a historical/service-side self-favorite row. Aggregates must still
-- exclude it even though privileged maintenance can bypass RLS.
insert into public.favorites (user_id, novel_id)
values ('fa400000-0000-4000-8000-000000000001',9984001);

select public.beta_final_test_assert(
  public.novelight_favorite_count('9984001') = 1,
  'public favorite count must exclude author self-favorites'
);
select public.beta_final_test_assert(
  (
    select favorite_count = 1 and score = 12
    from public.novelight_ranking_feed_v2('total',100)
    where novel_id = '9984001'
  ),
  'ranking must exclude self-favorites and use unique qualified readers'
);

select public.novelight_recalculate_work_ranks(now());

select public.beta_final_test_assert(
  (
    select last_valid_read_count = 2
       and last_favorite_count = 1
    from public.novel_rank_state
    where novel_id_snapshot = '9984001'
  ),
  'Work Rank evidence must use unique readers and self-safe favorites'
);

-- Legacy direct RPC callers using p_sort=PV no longer receive raw-PV ordering.
select public.beta_final_test_assert(
  (
    select array_agg(novel_id order by ordinal)
    from (
      select novel_id, row_number() over () as ordinal
      from public.novelight_neutral_search(
        'Fairness Search',
        null,
        'pv',
        10,
        0
      )
    ) ordered
  ) = array['9984002','9984001']::text[],
  'legacy PV sort must follow launch-safe newness, not raw PV'
);

rollback;

select 'PASS: final beta fairness hardening blocks launch audit attack paths' as result;
