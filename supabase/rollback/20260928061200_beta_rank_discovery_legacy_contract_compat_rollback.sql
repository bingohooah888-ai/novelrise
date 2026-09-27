-- Guarded rollback for 20260928061200_beta_rank_discovery_legacy_contract_compat.sql.
-- Restores the pure beta no-op implementation from 20260928061000.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061200:rollback'));

create or replace function public.novelight_award_discovery_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end
$$;

revoke all on function public.novelight_award_discovery_points()
  from public, anon, authenticated;

commit;
