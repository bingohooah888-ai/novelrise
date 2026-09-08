\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values (
  '94000000-0000-0000-0000-000000000001',
  '{"display_name":"Analytics Runtime Author"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, plan)
values (
  '94000000-0000-0000-0000-000000000001',
  'Analytics Runtime Author',
  'free'
)
on conflict (id) do update
set display_name = excluded.display_name,
    plan = excluded.plan;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  v_count integer;
  v_impressions bigint;
  v_legacy_count integer;
begin
  -- The regression this test protects against is a first-execution PL/pgSQL
  -- ambiguity between RETURNS TABLE output variables and unqualified ORDER BY
  -- column names. Merely executing this query would raise on the broken version.
  select count(*)::integer, max(f.impressions)
    into v_count, v_impressions
    from public.novelight_author_exposure_funnel_v2(30) f;

  if v_count <> 1 or coalesce(v_impressions, -1) <> 0 then
    raise exception
      'Free LIGHT ANALYTICS must execute and return one zero-valued aggregate row; count=%, impressions=%',
      v_count,
      v_impressions;
  end if;

  select count(*)::integer
    into v_legacy_count
    from public.novelight_author_exposure_funnel(30);

  if v_legacy_count <> 1 then
    raise exception
      'Legacy LIGHT ANALYTICS compatibility RPC must remain executable; count=%',
      v_legacy_count;
  end if;
end
$$;

reset role;
rollback;

select 'PASS: authenticated LIGHT ANALYTICS RPC executes without ambiguous ordering' as result;
