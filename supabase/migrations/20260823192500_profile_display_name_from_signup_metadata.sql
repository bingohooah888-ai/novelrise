-- NOVELIGHT: keep the signup display name when the profile row is created.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823192500'));

create or replace function public.novelight_fill_profile_display_name_from_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_display_name text;
begin
  if new.display_name is null or btrim(new.display_name) = '' then
    select left(btrim(u.raw_user_meta_data ->> 'display_name'), 40)
      into v_display_name
      from auth.users u
     where u.id = new.id
       and nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') is not null;

    if v_display_name is not null then
      new.display_name := v_display_name;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.novelight_fill_profile_display_name_from_signup() from public, anon, authenticated;

drop trigger if exists novelight_profiles_fill_signup_display_name on public.profiles;
create trigger novelight_profiles_fill_signup_display_name
before insert on public.profiles
for each row
execute function public.novelight_fill_profile_display_name_from_signup();

-- Repair profiles that were already created without the signup display name.
update public.profiles p
   set display_name = left(btrim(u.raw_user_meta_data ->> 'display_name'), 40)
  from auth.users u
 where p.id = u.id
   and (p.display_name is null or btrim(p.display_name) = '')
   and nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') is not null;

commit;
