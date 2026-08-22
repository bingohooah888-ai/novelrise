\set ON_ERROR_STOP on

-- The compact base fixture omits production analytics columns. Add the one
-- LIGHT SEED eligibility needs before running its production precheck.
alter table public.novels
  add column if not exists pv bigint not null default 0;

-- One existing published work is intentionally no longer unknown.
update public.novels
set pv = 1500
where id = '20000000-0000-0000-0000-000000000001';

-- A pool of eligible published works used for allowance and concurrency tests.
-- Administrative fixture inserts have no auth.uid(), so the author plan trigger
-- correctly treats these as import/test setup rather than user posting.
do $$
declare
  i integer;
begin
  for i in 1..24 loop
    insert into public.novels (id, user_id, status, pv) values (
      ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      '55555555-5555-5555-5555-555555555555',
      'published',
      0
    );
  end loop;
end
$$;
