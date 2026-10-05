do $$
declare
  v_read_def text;
  v_star_def text;
  v_progress_def text;
  v_cap integer;
begin
  if to_regprocedure('public.novelight_award_valid_read_scout_xp()') is null
     or to_regprocedure('public.set_novel_star_rating(text,integer)') is null
     or to_regprocedure('public.novelight_scout_campaign_progress(uuid,text)') is null then
    raise exception 'SCOUT 40-XP runtime is incomplete';
  end if;

  select pg_get_functiondef('public.novelight_award_valid_read_scout_xp()'::regprocedure)
    into v_read_def;
  if pg_catalog.strpos(v_read_def, 'v_work_awarded_today < 5') = 0
     or pg_catalog.strpos(v_read_def, '''valid_read'', 2, ''chapter49-beta-v2''') = 0
     or pg_catalog.strpos(v_read_def, 'v_episode_awarded_today < 15') = 0
     or pg_catalog.strpos(v_read_def, '''valid_read_episode'', 1, ''chapter49-beta-v2''') = 0 then
    raise exception 'SCOUT valid-read 40-XP rule drifted';
  end if;

  select pg_get_functiondef('public.set_novel_star_rating(text,integer)'::regprocedure)
    into v_star_def;
  if pg_catalog.strpos(v_star_def, '''scout_xp_eligible'', false') = 0
     or pg_catalog.strpos(v_star_def, '''star_rating'', 3') > 0 then
    raise exception 'SCOUT star-rating XP boundary drifted';
  end if;

  select daily_valid_read_xp_cap
    into v_cap
    from public.scout_reward_campaigns
   where campaign_key = 'scout-lv10-bookcard-500';
  if v_cap is distinct from 10 then
    raise exception 'SCOUT campaign work-read cap drifted';
  end if;

  select pg_get_functiondef(
    'public.novelight_scout_campaign_progress(uuid,text)'::regprocedure
  ) into v_progress_def;
  if pg_catalog.strpos(v_progress_def, '''today_valid_read_xp_cap'', 10') = 0
     or pg_catalog.strpos(v_progress_def, '''today_valid_read_episode_xp_cap'', 15') = 0
     or pg_catalog.strpos(v_progress_def, '''today_comment_xp_cap'', 15') = 0
     or pg_catalog.strpos(v_progress_def, '''today_activity_xp_cap'', 40') = 0 then
    raise exception 'SCOUT campaign 40-XP progress contract drifted';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.novelight_scout_campaign_progress(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'SCOUT campaign progress must remain server-only';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.novelight_scout_campaign_progress(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'SCOUT campaign progress service_role grant is missing';
  end if;
end
$$;
