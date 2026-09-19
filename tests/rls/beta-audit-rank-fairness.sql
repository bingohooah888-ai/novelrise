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

insert into auth.users (id) values
  ('fa100000-0000-4000-8000-000000000001');

update public.profiles
set display_name = 'Rank Audit Author', plan = 'free'
where id = 'fa100000-0000-4000-8000-000000000001';

insert into public.novels (
  id, user_id, title, description, genre, status, pv,
  ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version, first_published_at
) values (
  9981001,
  'fa100000-0000-4000-8000-000000000001',
  'Raw PV must not rank',
  'audit fixture',
  'ファンタジー',
  'published',
  1000000,
  'human',
  'general',
  '{}'::text[],
  true,
  'beta-v1',
  now()
);

select public.beta_audit_test_assert(
  (
    select valid_read_count = 0 and score = 0
    from public.novelight_ranking_feed_v2('total', 100)
    where novel_id = '9981001'
  ),
  'one million raw PV must contribute zero authoritative ranking score'
);

insert into public.valid_read_events (
  reader_id, novel_id_snapshot, episode_id_snapshot, author_id_snapshot,
  session_id, body_char_count, progress_signal, foreground_signal,
  interaction_signal, rule_version
) values (
  'fa100000-0000-4000-8000-000000000002',
  '9981001',
  '9981011',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000003',
  1000,
  true,
  true,
  false,
  'rank-audit'
);

select public.beta_audit_test_assert(
  (
    select valid_read_count = 1 and score = 1
    from public.novelight_ranking_feed_v2('total', 100)
    where novel_id = '9981001'
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
    'anon', 'public.novelight_ranking_feed(text,integer)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.novelight_ranking_feed(text,integer)', 'EXECUTE'
  ),
  'legacy raw-PV ranking feed must remain closed to clients'
);

select public.beta_audit_test_assert(
  has_function_privilege(
    'anon', 'public.novelight_ranking_feed_v2(text,integer)', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'public.novelight_ranking_feed_v2(text,integer)', 'EXECUTE'
  ),
  'valid-read ranking feed must remain available to readers'
);

rollback;

select 'PASS: raw PV is separated from authoritative public ranking and Rank floors' as result;
