-- NOVELIGHT: raise the Free plan novel limit from 1 to 2.
-- Standard and Premium limits remain 10 and 30. No user data is changed.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260920152733'));

create or replace function public.novelight_enforce_novel_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  current_plan text;
  current_count integer;
  max_novels integer;
begin
  -- Administrative/import operations without an end-user JWT are not plan-gated.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.user_id is distinct from (select auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'Novel ownership must match the authenticated user';
  end if;

  -- Serialize inserts for the same author so concurrent requests cannot race
  -- past the plan limit.
  select p.plan
  into current_plan
  from public.profiles as p
  where p.id = new.user_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'A valid author profile is required before posting a novel';
  end if;

  max_novels := case current_plan
    when 'free' then 2
    when 'standard' then 10
    when 'premium' then 30
    else null
  end;

  if max_novels is null then
    raise exception using
      errcode = '23514',
      message = 'Unsupported billing plan; novel creation is blocked';
  end if;

  select count(*)::integer
  into current_count
  from public.novels as n
  where n.user_id = new.user_id;
  if current_count >= max_novels then
    raise exception using
      errcode = '23514',
      message = format(
        'Novel limit reached for %s plan (%s)',
        current_plan,
        max_novels
      );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_enforce_novel_plan_limit()
  from public, anon, authenticated;

commit;
