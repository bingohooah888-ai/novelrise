-- Lightweight, read-only Home hero eligibility gate.
-- Avoid scanning contest entries and episode counts on every homepage visit.
-- The full catalog RPC remains unchanged for contest listing pages.
create or replace function public.novelight_public_contest_hero_gate_v1()
returns jsonb
language sql stable
security definer
set search_path = ''
as $hero_gate$
  select coalesce(
    (
      select case
        when c.public_visible is true
          and c.status in ('registration', 'active', 'review', 'finalized')
        then pg_catalog.jsonb_build_object(
          'ok', true,
          'contest_status', c.status,
          'entry_deadline_at', c.entry_deadline_at
        )
        else pg_catalog.jsonb_build_object(
          'ok', false,
          'reason', 'contest_unavailable'
        )
      end
      from public.novelight_contests c
      where c.contest_key = 'novelight-november-2026'
      limit 1
    ),
    pg_catalog.jsonb_build_object('ok', false, 'reason', 'contest_unavailable')
  );
$hero_gate$;

-- Expose only these three public scheduling fields, not private entry data.
revoke all on function public.novelight_public_contest_hero_gate_v1()
  from public, anon, authenticated;
grant execute on function public.novelight_public_contest_hero_gate_v1()
  to anon, authenticated;
