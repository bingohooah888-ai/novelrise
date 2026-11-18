\set ON_ERROR_STOP on

-- Manual recovery only. Never discard a reply history row, including failed or
-- uncertain deliveries. The transaction holds an exclusive lock through DROP.
begin;
do $$
declare
  v_table regclass := to_regclass('public.admin_inquiry_replies');
  v_has_rows boolean;
begin
  if v_table is not null then
    execute 'lock table public.admin_inquiry_replies in access exclusive mode';

    if not exists (
      select 1 from pg_attribute
       where attrelid = v_table and attname = 'idempotency_key'
         and atttypid = 'pg_catalog.text'::regtype and not attisdropped
    ) then
      raise exception 'Refusing rollback: existing table is not the expected reply history schema';
    end if;

    execute 'select exists (select 1 from public.admin_inquiry_replies limit 1)'
      into v_has_rows;
    if v_has_rows then
      raise exception 'Refusing rollback: reply history exists. Preserve records and use an app rollback instead';
    end if;
  end if;
end
$$;

drop table if exists public.admin_inquiry_replies;
commit;
