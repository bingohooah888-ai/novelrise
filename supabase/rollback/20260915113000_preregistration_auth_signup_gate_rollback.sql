-- IMPORTANT: disable the Production Before User Created Auth Hook before applying this rollback.
\set ON_ERROR_STOP on
begin;

drop function if exists public.hook_novelight_beta_signup_gate(jsonb);

drop policy if exists beta_author_preregistration_config_auth_signup_gate
  on public.beta_author_preregistration_config;

revoke select on table public.beta_author_preregistration_config
  from supabase_auth_admin;

-- Schema USAGE is intentionally not revoked: it may be shared by other Supabase Auth hooks.

commit;
