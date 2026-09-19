\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919195300:rollback'));

do $$
declare
  v_row record;
begin
  if (
    select count(*)
    from novelrise_migration_backup.beta_final_fairness_function_state
    where migration_id = '20260919195300'
  ) <> 8 then
    raise exception 'Final fairness rollback backup is incomplete';
  end if;

  for v_row in
    select function_signature, definition
    from novelrise_migration_backup.beta_final_fairness_function_state
    where migration_id = '20260919195300'
    order by function_signature
  loop
    execute v_row.definition;
  end loop;
end
$$;
drop policy if exists "Users can add own favorites" on public.favorites;
create policy "Users can add own favorites"
on public.favorites
for insert
to public
with check ((select auth.uid()) = user_id);

drop function if exists public.novelight_can_favorite_novel(bigint);
drop function if exists public.novelight_exposure_balance_start(timestamptz);
drop index if exists public.favorites_novel_id_user_id_idx;

commit;
