-- Clean Production Auth Smoke residue from SCOUT RECORD and prevent recurrence.
-- Also reconcile the single real reader who earned reader_seed_001 from a
-- pre-Badge-System LIGHT SEED but did not receive the configured +1 pt reward.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260926130000'));

create or replace function public.novelight_cleanup_internal_e2e_scout_residue(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal_e2e boolean := false;
begin
  if p_user_id is null then
    return;
  end if;

  select coalesce((u.raw_app_meta_data ->> 'internal_e2e')::boolean, false)
    into v_internal_e2e
    from auth.users u
   where u.id = p_user_id;

  if not coalesce(v_internal_e2e, false) then
    return;
  end if;

  delete from public.scout_point_operator_actions a
   where a.user_id = p_user_id
      or a.ledger_id in (
        select p.id
          from public.scout_point_ledger p
         where p.user_id = p_user_id
      );

  delete from public.scout_point_ledger p
   where p.user_id = p_user_id
      or p.reversal_of in (
        select p2.id
          from public.scout_point_ledger p2
         where p2.user_id = p_user_id
      );

  delete from public.scout_xp_ledger x
   where x.user_id = p_user_id;

  delete from public.scout_event_ledger e
   where e.user_id = p_user_id;

  delete from public.user_scout_badges b
   where b.user_id = p_user_id;

  delete from public.scout_badge_metric_events e
   where e.user_id = p_user_id;

  delete from public.scout_badge_metric_state s
   where s.user_id = p_user_id;

  delete from public.scout_point_user_controls c
   where c.user_id = p_user_id;

  delete from public.scout_record_usage_days d
   where d.user_id = p_user_id;

  delete from public.light_seed_monthly_inventory i
   where i.user_id = p_user_id;

  delete from public.seed_discovery_state d
   where d.reader_id = p_user_id;

  delete from public.valid_read_events e
   where e.reader_id = p_user_id;

  delete from public.valid_read_sessions s
   where s.reader_id = p_user_id;

  delete from public.scout_episode_badge_state s
   where s.author_id = p_user_id;
end
$$;

revoke all on function public.novelight_cleanup_internal_e2e_scout_residue(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_cleanup_internal_e2e_scout_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.novelight_cleanup_internal_e2e_scout_residue(old.id);
  return old;
end
$$;

revoke all on function public.novelight_cleanup_internal_e2e_scout_on_profile_delete()
  from public, anon, authenticated;

drop trigger if exists cleanup_internal_e2e_scout_before_profile_delete
  on public.profiles;
create trigger cleanup_internal_e2e_scout_before_profile_delete
before delete on public.profiles
for each row
execute function public.novelight_cleanup_internal_e2e_scout_on_profile_delete();

-- One-time cleanup for the orphaned Production Auth Smoke readers left behind by
-- runs completed before the trigger above existed. Identification is intentionally
-- strict: no Profile/Auth identity remains, the live LIGHT SEED is already gone,
-- and the residual SCOUT/read ledger shape exactly matches the authenticated smoke.
create temporary table novelight_scout_smoke_orphans (
  user_id uuid primary key
) on commit drop;

insert into novelight_scout_smoke_orphans (user_id)
select candidate.user_id
  from (
    select distinct b.user_id
      from public.user_scout_badges b
      left join public.profiles p on p.id = b.user_id
      left join auth.users u on u.id = b.user_id
     where b.badge_id = 'reader_seed_001'
       and b.status = 'earned'
       and p.id is null
       and u.id is null
  ) candidate
 where not exists (
         select 1
           from public.light_seeds s
          where s.reader_id = candidate.user_id
       )
   and (select count(*) from public.valid_read_sessions s
         where s.reader_id = candidate.user_id) = 2
   and (select count(*) from public.valid_read_events e
         where e.reader_id = candidate.user_id) = 2
   and (select count(*) from public.scout_event_ledger e
         where e.user_id = candidate.user_id) = 3
   and (select count(*) from public.scout_event_ledger e
         where e.user_id = candidate.user_id
           and e.event_type = 'valid_read') = 2
   and (select count(*) from public.scout_event_ledger e
         where e.user_id = candidate.user_id
           and e.event_type = 'light_seed_sent') = 1
   and (select count(*) from public.scout_xp_ledger x
         where x.user_id = candidate.user_id) = 2
   and coalesce((select sum(x.xp_value) from public.scout_xp_ledger x
                  where x.user_id = candidate.user_id), 0) = 12
   and (select count(*) from public.scout_point_ledger p
         where p.user_id = candidate.user_id) = 3
   and (select count(*) from public.scout_point_ledger p
         where p.user_id = candidate.user_id
           and p.point_kind = 'badge'
           and p.point_value = 1
           and p.status = 'confirmed') = 3
   and (select count(*) from public.seed_discovery_state d
         where d.reader_id = candidate.user_id) = 1
   and (select count(*) from public.light_seed_monthly_inventory i
         where i.user_id = candidate.user_id) = 1
   and (select count(*) from public.scout_record_usage_days d
         where d.user_id = candidate.user_id) = 1;

do $$
declare
  v_candidate_count integer;
begin
  select count(*) into v_candidate_count
    from novelight_scout_smoke_orphans;

  if v_candidate_count > 50 then
    raise exception 'Safety stop: SCOUT smoke orphan cleanup matched % users',
      v_candidate_count;
  end if;
end
$$;

delete from public.scout_point_operator_actions a
 where a.user_id in (select user_id from novelight_scout_smoke_orphans)
    or a.ledger_id in (
      select p.id
        from public.scout_point_ledger p
       where p.user_id in (select user_id from novelight_scout_smoke_orphans)
    );

delete from public.scout_point_ledger p
 where p.user_id in (select user_id from novelight_scout_smoke_orphans)
    or p.reversal_of in (
      select p2.id
        from public.scout_point_ledger p2
       where p2.user_id in (select user_id from novelight_scout_smoke_orphans)
    );

delete from public.scout_xp_ledger x
 where x.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.scout_event_ledger e
 where e.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.user_scout_badges b
 where b.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.scout_badge_metric_events e
 where e.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.scout_badge_metric_state s
 where s.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.scout_point_user_controls c
 where c.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.scout_record_usage_days d
 where d.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.light_seed_monthly_inventory i
 where i.user_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.seed_discovery_state d
 where d.reader_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.valid_read_events e
 where e.reader_id in (select user_id from novelight_scout_smoke_orphans);

delete from public.valid_read_sessions s
 where s.reader_id in (select user_id from novelight_scout_smoke_orphans);

-- Reconcile the real reader case that exposed the issue. This is deliberately
-- limited to reader_seed_001 and requires a live LIGHT SEED plus an existing
-- Profile/Auth identity. The canonical badge event_key keeps it idempotent.
insert into public.scout_point_ledger (
  user_id,
  point_kind,
  point_value,
  status,
  event_key,
  occurred_at,
  metadata
)
select
  b.user_id,
  'badge',
  d.point_reward,
  'confirmed',
  'badge:' || b.user_id::text || ':' || b.badge_id,
  coalesce(b.earned_at, now()),
  pg_catalog.jsonb_build_object(
    'badge_id', b.badge_id,
    'reason_type', 'badge_reward',
    'reason_id', b.badge_id,
    'display_name', d.display_name,
    'rule_version', 'badge-system-beta-2026-09-21',
    'reconciled_by', '20260926130000_scout_smoke_residue_cleanup'
  )
from public.user_scout_badges b
join public.scout_badge_definitions d
  on d.badge_id = b.badge_id
join public.profiles profile
  on profile.id = b.user_id
join auth.users auth_user
  on auth_user.id = b.user_id
where b.badge_id = 'reader_seed_001'
  and b.status = 'earned'
  and d.badge_category = 'reader'
  and d.point_reward > 0
  and exists (
    select 1
      from public.light_seeds s
     where s.reader_id = b.user_id
  )
  and not exists (
    select 1
      from public.scout_point_ledger p
     where p.event_key = 'badge:' || b.user_id::text || ':' || b.badge_id
  );

comment on function public.novelight_cleanup_internal_e2e_scout_residue(uuid) is
  'Deletes SCOUT/read residue only for auth.users marked app_metadata.internal_e2e=true.';

commit;
