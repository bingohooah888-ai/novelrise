with checks as (
  select
    exists (
      select 1
      from supabase_migrations.schema_migrations m
      where m.version = '20260823192500'
    ) as signup_name_migration_applied,
    not exists (
      select 1
      from public.profiles p
      where coalesce(btrim(p.display_name), '') = ''
    ) as profile_names_present,
    exists (
      select 1
      from public.user_acquisition a
    ) as acquisition_claims_present,
    not exists (
      select 1
      from public.user_acquisition a
      where char_length(a.first_visitor_key_hash) <> 32
         or coalesce(btrim(a.source), '') = ''
    ) as acquisition_rows_valid,
    exists (
      select 1
      from public.user_lifecycle l
    ) as lifecycle_rows_present,
    not exists (
      select 1
      from public.user_lifecycle l
      where l.registered_at is null
         or l.first_seen_at is null
         or l.last_seen_at is null
         or l.last_seen_at < l.first_seen_at
    ) as lifecycle_rows_valid,
    exists (
      select 1
      from public.beta_activity_days d
      where d.activity_date >= timezone('Asia/Tokyo', now())::date - 1
    ) as recent_activity_present,
    not exists (
      select 1
      from public.beta_activity_days d
      where char_length(d.viewer_key_hash) <> 32
         or d.visit_count <= 0
         or coalesce(btrim(d.first_path), '') = ''
         or coalesce(btrim(d.latest_path), '') = ''
    ) as activity_rows_valid,
    not exists (
      select 1
      from public.user_acquisition a
      left join public.user_lifecycle l on l.user_id = a.user_id
      where l.user_id is null
    ) as acquisition_has_lifecycle,
    not exists (
      select 1
      from public.acquisition_touches t
      where char_length(t.visitor_key_hash) <> 32
    ) as acquisition_tokens_hashed
), summary as (
  select
    *,
    signup_name_migration_applied
      and profile_names_present
      and acquisition_rows_valid
      and lifecycle_rows_valid
      and activity_rows_valid
      and acquisition_has_lifecycle
      and acquisition_tokens_hashed as integrity_ok,
    acquisition_claims_present
      and lifecycle_rows_present
      and recent_activity_present as monitoring_ok
  from checks
)
select
  integrity_ok as ok,
  integrity_ok,
  monitoring_ok,
  signup_name_migration_applied,
  profile_names_present,
  acquisition_claims_present,
  acquisition_rows_valid,
  lifecycle_rows_present,
  lifecycle_rows_valid,
  recent_activity_present,
  activity_rows_valid,
  acquisition_has_lifecycle,
  acquisition_tokens_hashed
from summary;
