-- Record the Production hotfix for account deletion.
-- The delete-account API runs with service_role and needs to read/delete
-- episode_illustrations owned by the account being removed.

grant all privileges on table public.episode_illustrations to service_role;
