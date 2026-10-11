-- STAGING ONLY. DDL metadata change: enable RLS on five already
-- inaccessible-to-reader-role tables to match verified Production policy.
-- No row updates, truncation, or schema_migrations history modification.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
\i supabase/checks/staging_rls_parity_precheck.sql
alter table public.light_seed_rules enable row level security;
alter table public.novel_allocation_receipts enable row level security;
alter table public.novel_exposure_conversions enable row level security;
alter table public.novel_exposure_events enable row level security;
alter table public.novel_exposure_rules enable row level security;
\i supabase/checks/staging_rls_parity_postcheck.sql
commit;
