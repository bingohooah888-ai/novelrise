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
  ('fa200000-0000-4000-8000-000000000001'),
  ('fa200000-0000-4000-8000-000000000002');

update public.profiles
set display_name = case id
  when 'fa200000-0000-4000-8000-000000000001'::uuid then 'Preopen Older'
  else 'Preopen Newer'
end,
plan = 'free'
where id in (
  'fa200000-0000-4000-8000-000000000001'::uuid,
  'fa200000-0000-4000-8000-000000000002'::uuid
);

insert into public.novels (
  id, user_id, title, description, genre, status, pv,
  ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version,
  created_at, first_published_at
) values
  (
    9982001,
    'fa200000-0000-4000-8000-000000000001',
    'Preopen older work',
    'launch audit',
    'ファンタジー',
    'published',
    0,
    'human',
    'general',
    '{}'::text[],
    true,
    'beta-v1',
    timestamptz '2026-09-20 12:00:00+09',
    timestamptz '2026-09-20 12:00:00+09'
  ),
  (
    9982002,
    'fa200000-0000-4000-8000-000000000002',
    'Preopen newer work',
    'launch audit',
    'ファンタジー',
    'published',
    0,
    'human',
    'general',
    '{}'::text[],
    true,
    'beta-v1',
    timestamptz '2026-09-28 12:00:00+09',
    timestamptz '2026-09-28 12:00:00+09'
  );

select public.beta_audit_test_assert(
  public.novelight_effective_publication_at(
    timestamptz '2026-09-20 12:00:00+09',
    timestamptz '2026-09-20 12:00:00+09'
  ) = timestamptz '2026-09-30 00:00:00+09',
  'preopen publication must start launch-relative clocks at September 30 JST'
);

select public.beta_audit_test_assert(
  (
    select array_agg(novel_id order by ordinal)
    from (
      select novel_id, row_number() over () as ordinal
      from public.novelight_neutral_search(null, null, 'new', 100, 0)
      where novel_id in ('9982001', '9982002')
    ) q
  ) = array['9982002', '9982001']::text[],
  'preopen works must retain real relative order inside the shared launch timestamp'
);

select public.novelight_trusted_discovery_feed_v2(
  'home_discovery',
  1,
  'Preopen newer work',
  null,
  'launch-audit-visitor'
);

select public.beta_audit_test_assert(
  exists (
    select 1
    from public.novel_allocation_receipts r
    where r.novel_id_snapshot = '9982002'
      and r.allocation_reason = 'balanced'
  ),
  'before September 30 a preopen impression receipt must not consume initial exposure'
);

select public.beta_audit_test_assert(
  not exists (
    select 1
    from public.novel_allocation_receipts r
    where r.novel_id_snapshot = '9982002'
      and r.allocation_reason = 'initial_exposure'
  ),
  'preopen receipt must never be attributed as initial exposure before launch'
);

rollback;

select 'PASS: preopen works preserve order without consuming launch-timed benefits' as result;
