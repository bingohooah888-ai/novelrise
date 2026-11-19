\set ON_ERROR_STOP on

-- Validate the actual private reply schema after application, without reading replies.
do $$
declare
  v_table regclass := to_regclass('public.admin_inquiry_replies');
  v_seq regclass := to_regclass('public.admin_inquiry_replies_id_seq');
  v_parent regclass := to_regclass('public.contact_inquiries');
  v_predicate text;
begin
  if v_table is null or v_seq is null or v_parent is null then
    raise exception 'Postcheck failed: reply history table, sequence or parent inquiry table is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = v_table) then
    raise exception 'Postcheck failed: reply history RLS is disabled';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'admin_inquiry_replies'
  ) then
    raise exception 'Postcheck failed: reply history must have no client-facing RLS policies';
  end if;

  if has_table_privilege('anon', v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_sequence_privilege('anon', v_seq, 'USAGE, SELECT, UPDATE')
     or has_sequence_privilege('authenticated', v_seq, 'USAGE, SELECT, UPDATE') then
    raise exception 'Postcheck failed: client roles have access to private reply history';
  end if;

  if not exists (
    select 1 from pg_attribute
     where attrelid = v_table
       and attname = 'idempotency_key'
       and atttypid = 'pg_catalog.text'::regtype
       and attnotnull and not attisdropped
  ) then
    raise exception 'Postcheck failed: non-null text idempotency key is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_table and contype = 'f'
       and confrelid = v_parent and confdeltype = 'c'
  ) then
    raise exception 'Postcheck failed: reply history inquiry foreign key is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_table and contype = 'c'
       and pg_get_constraintdef(oid) like '%sending%'
       and pg_get_constraintdef(oid) like '%sent%'
       and pg_get_constraintdef(oid) like '%failed%'
  ) then
    raise exception 'Postcheck failed: reply status constraint is missing';
  end if;

  select pg_get_expr(i.indpred, i.indrelid)
    into v_predicate
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_attribute a on a.attrelid = i.indrelid
   where i.indrelid = v_table
     and idx.relname = 'admin_inquiry_replies_active_key_unique_idx'
     and i.indisunique and i.indisvalid
     and i.indnkeyatts = 1
     and i.indkey[0] = a.attnum
     and a.attname = 'idempotency_key'
     and i.indpred is not null;

  if v_predicate is null
     or v_predicate not like '%sending%'
     or v_predicate not like '%sent%'
     or v_predicate like '%failed%' then
    raise exception 'Postcheck failed: atomic active/sent idempotency constraint is invalid';
  end if;

  if not exists (
    select 1 from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = v_table
      and idx.relname = 'admin_inquiry_replies_inquiry_created_idx'
      and i.indisvalid
  ) then
    raise exception 'Postcheck failed: reply history lookup index is missing';
  end if;
end
$$;
