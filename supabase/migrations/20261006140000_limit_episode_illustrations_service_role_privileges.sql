-- Tighten the Production account-deletion hotfix to least privilege.
-- The delete-account API only needs to read illustration paths and delete
-- illustration rows owned by the account being removed.

revoke all privileges on table public.episode_illustrations from service_role;
grant select, delete on table public.episode_illustrations to service_role;

do $$
begin
  if not has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'SELECT'
  ) or not has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'DELETE'
  ) then
    raise exception 'service_role is missing required account-deletion illustration privileges';
  end if;

  if has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'UPDATE'
  ) or has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'TRUNCATE'
  ) or has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'REFERENCES'
  ) or has_table_privilege(
    'service_role',
    'public.episode_illustrations',
    'TRIGGER'
  ) then
    raise exception 'service_role has broader episode_illustrations privileges than required';
  end if;
end
$$;
