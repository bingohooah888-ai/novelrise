\set ON_ERROR_STOP on

-- Profile owner may change public profile fields, but not billing-owned fields.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

update public.profiles
set display_name = 'Updated Free Author',
    bio = 'Updated bio'
where id = '33333333-3333-3333-3333-333333333333';

select public.test_assert(
  exists (
    select 1
    from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and display_name = 'Updated Free Author'
      and bio = 'Updated bio'
  ),
  'owner must be able to update display_name and bio'
);

do $$
begin
  begin
    update public.profiles
    set plan = 'premium'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed plan';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set payment_status = 'failed'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed payment_status';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set stripe_customer_id = 'cus_hijacked'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed stripe_customer_id';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set display_name = 'Hijacked'
    where id = '44444444-4444-4444-4444-444444444444';
    raise exception 'user unexpectedly changed another profile';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

-- Free: first novel succeeds, second is rejected.
insert into public.novels (id, user_id, status) values (
  '30000000-0000-0000-0000-000000000001',
  '33333333-3333-3333-3333-333333333333',
  'published'
);

do $$
begin
  begin
    insert into public.novels (id, user_id, status) values (
      '30000000-0000-0000-0000-000000000002',
      '33333333-3333-3333-3333-333333333333',
      'published'
    );
    raise exception 'free user unexpectedly exceeded one novel';
  exception
    when check_violation then null;
  end;
end
$$;

select public.test_assert(
  (select count(*) = 1
   from public.novels
   where user_id = '33333333-3333-3333-3333-333333333333'),
  'free user must remain capped at one novel'
);

-- Standard: ten novels succeed, eleventh is rejected.
do $$
declare
  i integer;
begin
  for i in 1..10 loop
    insert into public.novels (id, user_id, status) values (
      ('40000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      '44444444-4444-4444-4444-444444444444',
      'published'
    );
  end loop;
end
$$;

do $$
begin
  begin
    insert into public.novels (id, user_id, status) values (
      '40000000-0000-0000-0000-000000000011',
      '44444444-4444-4444-4444-444444444444',
      'published'
    );
    raise exception 'standard user unexpectedly exceeded ten novels';
  exception
    when check_violation then null;
  end;
end
$$;

select public.test_assert(
  (select count(*) = 10
   from public.novels
   where user_id = '44444444-4444-4444-4444-444444444444'),
  'standard user must remain capped at ten novels'
);

-- Premium: thirty novels succeed, thirty-first is rejected.
do $$
declare
  i integer;
begin
  for i in 1..30 loop
    insert into public.novels (id, user_id, status) values (
      ('50000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      '55555555-5555-5555-5555-555555555555',
      'published'
    );
  end loop;
end
$$;

do $$
begin
  begin
    insert into public.novels (id, user_id, status) values (
      '50000000-0000-0000-0000-000000000031',
      '55555555-5555-5555-5555-555555555555',
      'published'
    );
    raise exception 'premium user unexpectedly exceeded thirty novels';
  exception
    when check_violation then null;
  end;
end
$$;

select public.test_assert(
  (select count(*) = 30
   from public.novels
   where user_id = '55555555-5555-5555-5555-555555555555'),
  'premium user must remain capped at thirty novels'
);

reset role;

select 'PASS: billing fields and plan novel limits are protected' as result;
