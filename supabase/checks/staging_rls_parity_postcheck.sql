-- All public tables must have RLS enabled after the metadata-only change.
do $check$
declare
  expected text[] := array[
    'light_seed_rules',
    'novel_allocation_receipts',
    'novel_exposure_conversions',
    'novel_exposure_events',
    'novel_exposure_rules'
  ];
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 158
    or exists (
      select 1 from pg_class c
      join pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname='public' and c.relkind in ('r','p')
        and not c.relrowsecurity
    )
    or (select count(*) from pg_class c
      join pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname='public' and c.relkind in ('r','p')
        and c.relname=any(expected) and c.relrowsecurity) <> 5
  then
    raise exception 'Staging RLS parity postcheck failed';
  end if;
end
$check$;
