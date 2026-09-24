\set ON_ERROR_STOP on

-- Reader 3 exhausted all 11 typed LIGHT SEEDs in the Chapter 38 fixture.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

select public.test_assert(
  (public.novelight_light_seed_inventory()->>'remaining_this_month')::integer = 0
  and (public.novelight_light_seed_inventory()->>'gold_remaining')::integer = 0
  and (public.novelight_light_seed_inventory()->>'silver_remaining')::integer = 0
  and (public.novelight_light_seed_inventory()->>'bronze_remaining')::integer = 0,
  'exhausted reader inventory must report zero remaining for all typed LIGHT SEEDs'
);

do $$
begin
  begin
    perform public.novelight_author_received_light_seed_summary(
      '10000000-0000-0000-0000-000000000001'
    );
    raise exception 'non-owner unexpectedly viewed received LIGHT SEED breakdown';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- Author 1 owns the fixture work that received Reader 3's GOLD seed.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select public.test_assert(
  (public.novelight_author_received_light_seed_summary(
    '10000000-0000-0000-0000-000000000001'
  )->>'total_seed_count')::integer >= 1,
  'owner must see total received LIGHT SEED count'
);

select public.test_assert(
  (public.novelight_author_received_light_seed_summary(
    '10000000-0000-0000-0000-000000000001'
  )->>'gold_count')::integer >= 1,
  'owner must see typed GOLD received count'
);

reset role;

-- A current-month user with no usage sees the full 6 / 3 / 2 inventory.
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);

select public.test_assert(
  (public.novelight_light_seed_inventory()->>'gold_remaining')::integer = 6
  and (public.novelight_light_seed_inventory()->>'silver_remaining')::integer = 3
  and (public.novelight_light_seed_inventory()->>'bronze_remaining')::integer = 2
  and (public.novelight_light_seed_inventory()->>'remaining_this_month')::integer = 11,
  'fresh monthly inventory must report GOLD 6 / SILVER 3 / BRONZE 2'
);

reset role;

-- Anonymous clients must not receive either owner/user private summary.
set role anon;

do $$
begin
  begin
    perform public.novelight_light_seed_inventory();
    raise exception 'anonymous client unexpectedly read LIGHT SEED inventory';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  begin
    perform public.novelight_author_received_light_seed_summary(
      '10000000-0000-0000-0000-000000000001'
    );
    raise exception 'anonymous client unexpectedly read received LIGHT SEED summary';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
