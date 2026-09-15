-- NOVELIGHT: remove a redundant unique index on favorites(user_id, novel_id).
-- favorites_user_id_novel_id_key is the backing index for the table UNIQUE
-- constraint and remains the source of truth.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915191000-favorites-duplicate-index'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.favorites'::regclass
      and c.conname = 'favorites_user_id_novel_id_key'
      and c.contype = 'u'
  ) then
    raise exception 'favorites_user_id_novel_id_key UNIQUE constraint is required';
  end if;
end
$$;

drop index if exists public.favorites_user_novel_unique;

commit;
