-- Production-safe rollback for SCOUT title/equipped-title semantics.
-- Do not make every earned title public again: that would overwrite user choices
-- made after this migration. Internal identifiers remain unchanged.
begin;

drop trigger if exists scout_title_default_unequipped on public.user_scout_badges;
drop function if exists public.novelight_force_new_scout_title_unequipped();
drop index if exists public.user_scout_single_equipped_title_idx;

alter table public.user_scout_badges
  alter column is_public set default true;

create or replace function public.novelight_set_scout_badge_visibility(
  p_badge_id text,
  p_is_public boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  update public.user_scout_badges b
     set is_public = coalesce(p_is_public, false),
         updated_at = now()
   where b.user_id = v_uid
     and b.badge_id = p_badge_id
     and b.status = 'earned';

  return found;
end
$$;

revoke all on function public.novelight_set_scout_badge_visibility(text, boolean)
  from public, anon;
grant execute on function public.novelight_set_scout_badge_visibility(text, boolean)
  to authenticated;

comment on function public.novelight_set_scout_badge_visibility(text, boolean) is
  'Rollback compatibility behavior. Existing user title visibility choices are preserved.';

commit;
