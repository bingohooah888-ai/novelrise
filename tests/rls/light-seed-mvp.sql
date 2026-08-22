\set ON_ERROR_STOP on

-- Anonymous visitors can inspect whether a work is seedable, but cannot plant.
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  public.light_seed_status('10000000-0000-0000-0000-000000000001'::uuid)->>'reason' = 'login_required',
  'anonymous published/unknown status should require login'
);

reset role;

-- Authors cannot seed their own work.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

do $$
begin
  begin
    perform public.plant_light_seed('10000000-0000-0000-0000-000000000001'::uuid);
    raise exception 'author unexpectedly seeded own work';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

-- Reader 3 exercises direct-write blocking, eligibility, duplicate prevention,
-- the monthly allowance, and own-history RLS.
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

do $$
begin
  begin
    insert into public.light_seeds (
      reader_id,
      novel_id,
      novel_id_snapshot,
      author_id_snapshot,
      seed_month,
      pv_at_seed,
      favorites_at_seed,
      rule_version
    ) values (
      '33333333-3333-3333-3333-333333333333',
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      date_trunc('month', timezone('Asia/Tokyo', now()))::date,
      0,
      0,
      'forged'
    );
    raise exception 'reader unexpectedly wrote light_seeds directly';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

select public.test_assert(
  public.light_seed_status('20000000-0000-0000-0000-000000000001'::uuid)->>'reason' = 'no_longer_unknown',
  'high-PV work should no longer be LIGHT SEED eligible'
);

do $$
begin
  begin
    perform public.plant_light_seed('20000000-0000-0000-0000-000000000001'::uuid);
    raise exception 'reader unexpectedly seeded high-PV work';
  exception
    when check_violation then null;
  end;
end
$$;

select public.plant_light_seed(
  '10000000-0000-0000-0000-000000000001'::uuid
);

select public.test_assert(
  (public.light_seed_status('10000000-0000-0000-0000-000000000001'::uuid)->>'already_seeded')::boolean,
  'seeded work should report already_seeded'
);

select public.test_assert(
  (public.light_seed_status('70000000-0000-0000-0000-000000000001'::uuid)->>'remaining_this_month')::integer = 9,
  'one successful seed should leave nine monthly seeds'
);

do $$
begin
  begin
    perform public.plant_light_seed('10000000-0000-0000-0000-000000000001'::uuid);
    raise exception 'reader unexpectedly seeded same work twice';
  exception
    when unique_violation then null;
  end;
end
$$;

do $$
declare
  i integer;
begin
  for i in 1..9 loop
    perform public.plant_light_seed(
      ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
    );
  end loop;
end
$$;

select public.test_assert(
  (select count(*) = 10
   from public.light_seeds
   where reader_id = '33333333-3333-3333-3333-333333333333'
     and seed_month = date_trunc('month', timezone('Asia/Tokyo', now()))::date),
  'reader must have exactly ten successful seeds in the month'
);

select public.test_assert(
  (public.light_seed_status('70000000-0000-0000-0000-000000000010'::uuid)->>'reason') = 'monthly_limit_reached',
  'status should report monthly limit after ten seeds'
);

do $$
begin
  begin
    perform public.plant_light_seed('70000000-0000-0000-0000-000000000010'::uuid);
    raise exception 'reader unexpectedly exceeded monthly seed limit';
  exception
    when check_violation then null;
  end;
end
$$;

-- Another reader must not see Reader 3's append-only history through table RLS.
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  false
);

select public.test_assert(
  (select count(*) = 0 from public.light_seeds),
  'reader must only see own LIGHT SEED history'
);

reset role;

-- Preserve discovery history when a novel is later deleted.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '66666666-6666-6666-6666-666666666666',
  false
);

select public.plant_light_seed('70000000-0000-0000-0000-000000000024'::uuid);

reset role;

delete from public.novels
where id = '70000000-0000-0000-0000-000000000024';

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '66666666-6666-6666-6666-666666666666',
  false
);

select public.test_assert(
  exists (
    select 1
    from public.light_seeds
    where reader_id = '66666666-6666-6666-6666-666666666666'
      and novel_id is null
      and novel_id_snapshot = '70000000-0000-0000-0000-000000000024'
  ),
  'seed history must survive later novel deletion'
);

reset role;

select 'PASS: LIGHT SEED MVP behavior' as result;
