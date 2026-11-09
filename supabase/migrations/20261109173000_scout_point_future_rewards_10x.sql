-- NOVELIGHT Scout Point earned rewards x10, FUTURE AWARDS ONLY.
-- Keep XP/Rank, event keys, badge criteria and already-awarded Point unchanged.
-- Reader badge reward values are read from scout_badge_definitions by existing RPCs/UI.

UPDATE public.scout_badge_definitions
SET point_reward = point_reward * 10
WHERE badge_category = 'reader' AND point_reward > 0;

create or replace function public.novelight_award_level_up_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_total bigint;
  v_old_total bigint;
  v_old_level smallint;
  v_new_level smallint;
  v_level integer;
begin
  if new.xp_value <= 0 or new.xp_kind = 'light_seed_discovery' then
    return new;
  end if;

  select coalesce(sum(x.xp_value), 0)::bigint into v_new_total
    from public.scout_xp_ledger x
   where x.user_id = new.user_id
     and x.xp_kind <> 'light_seed_discovery';

  v_old_total := greatest(v_new_total - new.xp_value, 0);
  v_old_level := public.novelight_scout_level_for_xp(v_old_total);
  v_new_level := public.novelight_scout_level_for_xp(v_new_total);

  if v_new_level <= v_old_level then
    return new;
  end if;

  for v_level in (v_old_level + 1)..v_new_level loop
    insert into public.scout_point_ledger (
      user_id, source_xp_id, point_kind, point_value, status,
      event_key, occurred_at, metadata
    ) values (
      new.user_id,
      new.id,
      'level_up',
      50,
      'confirmed',
      'level_up:' || new.user_id::text || ':' || v_level::text,
      new.occurred_at,
      pg_catalog.jsonb_build_object(
        'level', v_level,
        'rule_version', 'chapter49-beta-rank-private-v1'
      )
    )
    on conflict (event_key) do nothing;
  end loop;

  return new;
end
$$;
