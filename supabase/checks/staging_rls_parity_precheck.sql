-- Read-only precheck. Exact five long-standing tables with RLS disabled.
-- No authenticated or anonymous table grants are allowed during this correction.
do $check$
declare
  expected text[] := array[
    'light_seed_rules',
    'novel_allocation_receipts',
    'novel_exposure_conversions',
    'novel_exposure_events',
    'novel_exposure_rules'
  ];
  c record;
  n integer := 0;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 158 then
    raise exception 'Staging migration version count drifted';
  end if;
  if exists (
    select 1 from pg_class c
    join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind in ('r','p')
      and not c.relrowsecurity and c.relname <> all(expected)
  ) then
    raise exception 'RLS disabled on unexpected public table';
  end if;
  for c in
    select t.oid,t.relname,t.relrowsecurity
    from pg_class t
    join pg_namespace ns on ns.oid=t.relnamespace
    where ns.nspname='public' and t.relkind in ('r','p')
      and t.relname = any(expected)
  loop
    n := n+1;
    if c.relrowsecurity
      or exists (select 1 from pg_policies
         where schemaname='public' and tablename=c.relname)
      or has_table_privilege('anon',c.oid,'SELECT')
      or has_table_privilege('anon',c.oid,'INSERT')
      or has_table_privilege('anon',c.oid,'UPDATE')
      or has_table_privilege('anon',c.oid,'DELETE')
      or has_table_privilege('authenticated',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('public',c.oid,'SELECT')
      or has_table_privilege('public',c.oid,'INSERT')
      or has_table_privilege('public',c.oid,'UPDATE')
      or has_table_privilege('public',c.oid,'DELETE')
    then
      raise exception 'RLS/grants/policies drift for public.%', c.relname;
    end if;
  end loop;
  if n<>5 then
    raise exception 'Expected exactly five tables for RLS alignment; got %', n;
  end if;
end
$check$;
