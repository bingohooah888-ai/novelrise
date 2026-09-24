\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.light_seeds') is null then
    raise exception 'LIGHT SEED history table is missing';
  end if;

  if to_regclass('public.light_seed_monthly_inventory') is null then
    raise exception 'LIGHT SEED monthly inventory is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'light_seeds'
      and column_name = 'seed_type'
  ) then
    raise exception 'Typed LIGHT SEED schema is missing';
  end if;

  if to_regprocedure('public.light_seed_status_v2(text)') is null then
    raise exception 'LIGHT SEED v2 runtime is missing';
  end if;

  if to_regprocedure('public.novelight_light_seed_inventory()') is not null
     or to_regprocedure('public.novelight_author_received_light_seed_summary(text)') is not null then
    raise exception 'LIGHT SEED inventory/received summary RPC already exists; reconcile before apply';
  end if;
end
$$;
