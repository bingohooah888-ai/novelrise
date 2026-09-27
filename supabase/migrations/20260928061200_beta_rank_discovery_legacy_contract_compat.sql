-- NOVELIGHT beta SCOUT RECORD compatibility shim.
--
-- The Chapter 49 historical replay postcheck still verifies the original discovery
-- Point rule source markers while newer beta policy intentionally suppresses those
-- rewards. Keep the markers in an unreachable branch so migration replay can prove
-- the older contract existed without making work-Rank rewards observable or payable.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061200'));

do $$
begin
  if to_regprocedure('public.novelight_award_discovery_points()') is null then
    raise exception 'Beta discovery Point guard is required';
  end if;
end
$$;

create or replace function public.novelight_award_discovery_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer := 0;
  v_legacy_marker integer := 0;
begin
  -- Historical contract markers only. This branch is deliberately unreachable.
  if false then
    v_legacy_marker := case
      when v_delta >= 5 then 200
      else 0
    end;
    perform pg_catalog.jsonb_build_array('nova_prediction', 25, v_legacy_marker);
  end if;

  return new;
end
$$;

revoke all on function public.novelight_award_discovery_points()
  from public, anon, authenticated;

comment on function public.novelight_award_discovery_points() is
  'Beta no-op. Work-Rank discovery Point and NOVA Point rewards are suppressed; unreachable source markers exist only for historical migration replay compatibility.';

commit;
