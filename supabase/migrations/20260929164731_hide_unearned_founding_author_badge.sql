-- Repository history copy of the already-applied Production hotfix.
CREATE OR REPLACE FUNCTION public.novelight_scout_badges()
 RETURNS TABLE(badge_id text, badge_category text, difficulty text, display_name text, description text, condition_type text, target_value bigint, point_reward integer, is_limited boolean, is_hidden boolean, sort_order integer, progress_value bigint, progress_percent numeric, earned_at timestamp with time zone, status text, is_public boolean, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  perform public.novelight_refresh_my_scout_badges();

  return query
  select
    d.badge_id,
    d.badge_category,
    d.difficulty,
    case
      when d.is_hidden and b.earned_at is null then '???'
      when d.badge_id = 'limited_founding_author'
           and (b.metadata->>'founding_number') ~ '^[0-9]+$'
        then 'Founding Author #' || lpad((b.metadata->>'founding_number'), 3, '0')
      else d.display_name
    end,
    case
      when d.is_hidden and b.earned_at is null then '未公開称号'
      else d.description
    end,
    d.condition_type,
    d.target_value,
    d.point_reward,
    d.is_limited,
    d.is_hidden,
    d.sort_order,
    coalesce(b.progress_value, 0),
    coalesce(b.progress_percent, 0),
    b.earned_at,
    coalesce(b.status, 'in_progress'),
    coalesce(b.is_public, false),
    coalesce(b.metadata, '{}'::jsonb)
  from public.scout_badge_definitions d
  left join public.user_scout_badges b
    on b.user_id = v_uid
   and b.badge_id = d.badge_id
  where d.enabled
    and (
      d.badge_id <> 'limited_founding_author'
      or b.status = 'earned'
    )
  order by
    case d.badge_category when 'reader' then 1 when 'author' then 2 else 3 end,
    d.sort_order;
end
$function$;
