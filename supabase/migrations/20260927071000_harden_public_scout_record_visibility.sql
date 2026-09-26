-- Align public SCOUT RECORD visibility with the existing public profile contract.
-- Public callers may read a target only when that target has at least one published work.
-- The target user may always read their own SCOUT RECORD.

create or replace function public.novelight_public_scout_record(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_xp bigint;
  v_level smallint;
  v_rank_tier smallint;
  v_discoveries bigint;
  v_badges jsonb;
  v_representative jsonb;
begin
  if p_user_id is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_user_id
         and (
           p.id = (select auth.uid())
           or exists (
             select 1
             from public.novels n
             where n.user_id = p.id
               and n.status = 'published'
           )
         )
     ) then
    return null;
  end if;

  select t.cumulative_xp into v_cap
  from public.scout_level_thresholds t
  where t.level = 30;

  select least(coalesce(sum(x.xp_value), 0), v_cap)::bigint
    into v_xp
    from public.scout_xp_ledger x
   where x.user_id = p_user_id;

  v_level := public.novelight_scout_level_for_xp(v_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::smallint;

  select count(*)::bigint
    into v_discoveries
    from public.seed_discovery_state d
   where d.reader_id = p_user_id
     and (
       d.best_rank_delta >= 2
       or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
     );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'badge_id', d.badge_id,
        'category', d.badge_category,
        'difficulty', d.difficulty,
        'display_name',
          case
            when d.badge_id = 'limited_founding_author'
                 and (b.metadata->>'founding_number') ~ '^[0-9]+$'
              then 'Founding Author #' || lpad((b.metadata->>'founding_number'), 3, '0')
            else d.display_name
          end,
        'earned_at', b.earned_at
      )
      order by d.badge_category, d.sort_order
    ),
    '[]'::jsonb
  )
  into v_badges
  from public.user_scout_badges b
  join public.scout_badge_definitions d on d.badge_id = b.badge_id
  where b.user_id = p_user_id
    and b.status = 'earned'
    and b.is_public
    and d.enabled;

  select coalesce(
    pg_catalog.jsonb_agg(row_data order by sort_key desc),
    '[]'::jsonb
  )
  into v_representative
  from (
    select
      pg_catalog.jsonb_build_object(
        'novel_id', d.novel_id_snapshot,
        'title', case when n.status = 'published' then n.title else null end,
        'seed_type', d.seed_type,
        'rank_delta', d.best_rank_delta,
        'nova_prediction', d.rank_at_seed = 5 and d.highest_rank_seen = 6
      ) as row_data,
      greatest(d.best_rank_delta, 0)::integer as sort_key
    from public.seed_discovery_state d
    left join public.novels n on n.id::text = d.novel_id_snapshot
    where d.reader_id = p_user_id
      and (
        d.best_rank_delta >= 2
        or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
      )
    order by
      (d.rank_at_seed = 5 and d.highest_rank_seen = 6) desc,
      d.best_rank_delta desc,
      d.updated_at desc
    limit 3
  ) q;

  return pg_catalog.jsonb_build_object(
    'level', v_level,
    'rank_tier', v_rank_tier,
    'discovery_success_count', v_discoveries,
    'badges', v_badges,
    'representative_discoveries', v_representative
  );
end
$$;

revoke all on function public.novelight_public_scout_record(uuid)
  from public;
grant execute on function public.novelight_public_scout_record(uuid)
  to anon, authenticated;
