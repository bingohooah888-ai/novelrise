-- NOVELIGHT duplicate favorites index postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_constraint_count integer;
  v_duplicate_count integer;
begin
  select count(*) into v_constraint_count
  from pg_constraint c
  where c.conrelid = 'public.favorites'::regclass
    and c.conname = 'favorites_user_id_novel_id_key'
    and c.contype = 'u';

  select count(*) into v_duplicate_count
  from pg_indexes i
  where i.schemaname = 'public'
    and i.tablename = 'favorites'
    and i.indexname = 'favorites_user_novel_unique';

  if v_constraint_count <> 1 then
    raise exception 'favorites_user_id_novel_id_key UNIQUE constraint must remain';
  end if;

  if v_duplicate_count <> 0 then
    raise exception 'favorites_user_novel_unique duplicate index still exists';
  end if;
end
$$;

select 'PASS: duplicate favorites index postcheck' as result;
