-- Preserve the identity/link scanner and make the public admin scan entry point composite.

alter function public.novelight_trust_scan_user(uuid, integer)
  rename to novelight_trust_scan_identity;

revoke all on function public.novelight_trust_scan_identity(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_scan_identity(uuid,integer) to service_role;

create or replace function public.novelight_trust_scan_user(
  p_user_id uuid,
  p_window_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_behavior jsonb;
  v_profile jsonb;
begin
  v_identity := public.novelight_trust_scan_identity(p_user_id, p_window_days);
  v_behavior := public.novelight_trust_scan_behavior(p_user_id, p_window_days);
  v_profile := public.novelight_trust_recalculate_user(p_user_id);

  return jsonb_build_object(
    'profile', v_profile,
    'identity_scan', v_identity -> 'scan',
    'behavior_scan', v_behavior -> 'behavior_scan'
  );
end;
$$;

revoke all on function public.novelight_trust_scan_user(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_scan_user(uuid,integer) to service_role;

create or replace function public.novelight_trust_full_scan_user(
  p_user_id uuid,
  p_window_days integer default 60
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.novelight_trust_scan_user(p_user_id, p_window_days);
$$;

revoke all on function public.novelight_trust_full_scan_user(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_full_scan_user(uuid,integer) to service_role;
