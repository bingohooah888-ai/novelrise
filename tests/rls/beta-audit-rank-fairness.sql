\set ON_ERROR_STOP on

begin;

create or replace function public.beta_audit_test_assert(
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

create temporary table beta_audit_rank_target as
select
  n.id::text as novel_id,
  n.user_id as author_id
from public.novels n
where n.status = 'published'
order by n.id::text
limit 1;

select public.beta_audit_test_assert(
  exists (select 1 from beta_audit_rank_target),
  'rank fairness audit requires one published fixture work'
);

delete from public.valid_read_events vr
where vr.novel_id_snapshot = (
  select novel_id from beta_audit_rank_target
);

delete from public.favorites f
where f.novel_id::text = (
  select novel_id from beta_audit_rank_target
);

update public.novels n
set pv = 1000000
where n.id::text = (
  select novel_id from beta_audit_rank_target
);

select public.beta_audit_test_assert(
  (
    select valid_read_count = 0 and score = 0
    from public.novelight_ranking_feed_v2('total', 100)
    where novel_id = (select novel_id from beta_audit_rank_target)
  ),
  'one million raw PV must contribute zero authoritative ranking score'
);

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
  pg_catalog.gen_random_uuid(),
  t.novel_id,
  'beta-audit-rank-event',
  t.author_id,
  pg_catalog.gen_random_uuid(),
  1000,
  true,
  true,
  false,
  'rank-audit'
from beta_audit_rank_target t;

select public.beta_audit_test_assert(
  (
    select valid_read_count = 1 and score = 1
    from public.novelight_ranking_feed_v2('total', 100)
    where novel_id = (select novel_id from beta_audit_rank_target)
  ),
  'qualified read evidence must drive the authoritative ranking score'
);

select public.beta_audit_test_assert(
  public.novelight_rank_absolute_ceiling_v2(0, 10000, 1000, 5.0) = 1,
  'favorites and ratings cannot bypass the valid-read absolute floor'
);

select public.beta_audit_test_assert(
  public.novelight_rank_absolute_ceiling_v2(50, 2, 2, 3.0) = 2,
  'SPARK valid-read floor must remain 50 qualified reads'
);

select public.beta_audit_test_assert(
  not has_function_privilege(
    'anon',
    'public.novelight_ranking_feed(text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.novelight_ranking_feed(text,integer)',
    'EXECUTE'
  ),
  'legacy raw-PV ranking feed must remain closed to clients'
);

select public.beta_audit_test_assert(
  has_function_privilege(
    'anon',
    'public.novelight_ranking_feed_v2(text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.novelight_ranking_feed_v2(text,integer)',
    'EXECUTE'
  ),
  'valid-read ranking feed must remain available to readers'
);

rollback;

select 'PASS: raw PV is separated from authoritative public ranking and Rank floors' as result;
