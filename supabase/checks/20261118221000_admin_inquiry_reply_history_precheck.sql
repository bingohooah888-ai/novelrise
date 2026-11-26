\set ON_ERROR_STOP on

-- Catalog-only checks: never read or modify existing inquiry contents.
do $$
declare
  v_parent regclass := to_regclass('public.contact_inquiries');
begin
  if v_parent is null then
    raise exception 'Precheck failed: public.contact_inquiries is missing';
  end if;

  if not exists (
    select 1
      from pg_attribute a
      join pg_index i on i.indrelid = a.attrelid
     where a.attrelid = v_parent
       and a.attname = 'id'
       and a.atttypid = 'pg_catalog.int8'::regtype
       and a.attnotnull
       and not a.attisdropped
       and i.indisprimary
       and i.indnkeyatts = 1
       and i.indkey[0] = a.attnum
  ) then
    raise exception 'Precheck failed: contact_inquiries.id must be a bigint primary key';
  end if;

  if not (select relrowsecurity from pg_class where oid = v_parent) then
    raise exception 'Precheck failed: contact_inquiries RLS is disabled';
  end if;

  if to_regclass('public.admin_inquiry_replies') is not null then
    raise exception 'Precheck failed: reply history table already exists; do not overwrite existing data';
  end if;

  if to_regclass('public.admin_inquiry_replies_id_seq') is not null
     or to_regclass('public.admin_inquiry_replies_inquiry_created_idx') is not null
     or to_regclass('public.admin_inquiry_replies_active_key_unique_idx') is not null then
    raise exception 'Precheck failed: reply history sequence or index name is already in use';
  end if;
end
$$;
