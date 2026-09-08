-- Complete the SCOUT beta foundation privacy boundary for the internal
-- valid-read rule configuration. Direct grants are already revoked by the
-- preceding migration; RLS is enabled as the second defense-in-depth layer.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909071510'));

alter table public.valid_read_rules enable row level security;

commit;