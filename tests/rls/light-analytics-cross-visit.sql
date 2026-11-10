\set ON_ERROR_STOP on

-- Run only on a disposable replay database AFTER the Inquiry #84 migration.
-- Independent visits for one viewer must count as one continued reader.
begin;
insert into auth.users (id, raw_user_meta_data)
values ('96000000-0000-0000-0000-000000000001', '{"display_name":"Cross Visit Author"}'::jsonb)
on conflict(id) do nothing;
insert into public.profiles (id, display_name, plan)
values ('96000000-0000-0000-0000-000000000001', 'Cross Visit Author', 'free')
on conflict(id) do update set plan = excluded.plan;

insert into public.novel_exposure_events
  (id, viewer_key, viewer_id, surface, novel_id_snapshot, author_id_snapshot,
   plan_snapshot, rule_version, exposed_at, exposure_hour, allocation_reason)
values
  ('96000000-0000-0000-0000-000000000101', 'visitor:crossvisit-reader-a', null, 'home_discovery', '960001', '96000000-0000-0000-0000-000000000001', 'free', 'inquiry-84', now()-interval '20 days', date_trunc('hour',now()-interval '20 days'), 'balanced'),
  ('96000000-0000-0000-0000-000000000102', 'visitor:crossvisit-reader-a', null, 'home_discovery', '960001', '96000000-0000-0000-0000-000000000001', 'free', 'inquiry-84', now()-interval '4 days', date_trunc('hour',now()-interval '4 days'), 'balanced'),
  ('96000000-0000-0000-0000-000000000103', 'visitor:crossvisit-reader-b', null, 'home_discovery', '960001', '96000000-0000-0000-0000-000000000001', 'free', 'inquiry-84', now()-interval '3 days', date_trunc('hour',now()-interval '3 days'), 'balanced'),
  ('96000000-0000-0000-0000-000000000104', 'visitor:crossvisit-reader-c', null, 'home_discovery', '960001', '96000000-0000-0000-0000-000000000001', 'free', 'inquiry-84', now()-interval '2 days', date_trunc('hour',now()-interval '2 days'), 'balanced');

insert into public.novel_exposure_conversions
  (id, exposure_id, viewer_key_snapshot, novel_id_snapshot, author_id_snapshot,
   event_type, episode_id_snapshot, episode_number_snapshot, converted_at)
values
  ('96000000-0000-0000-0000-000000000201', '96000000-0000-0000-0000-000000000101', 'visitor:crossvisit-reader-a', '960001', '96000000-0000-0000-0000-000000000001', 'episode_read_10s', 'episode-cross-a-1', 1, now()-interval '20 days'+interval '1 minute'),
  ('96000000-0000-0000-0000-000000000202', '96000000-0000-0000-0000-000000000102', 'visitor:crossvisit-reader-a', '960001', '96000000-0000-0000-0000-000000000001', 'episode_read_10s', 'episode-cross-a-2', 2, now()-interval '4 days'+interval '1 minute'),
  ('96000000-0000-0000-0000-000000000203', '96000000-0000-0000-0000-000000000103', 'visitor:crossvisit-reader-b', '960001', '96000000-0000-0000-0000-000000000001', 'episode_read_10s', 'episode-cross-b-1', 1, now()-interval '3 days'+interval '1 minute'),
  ('96000000-0000-0000-0000-000000000204', '96000000-0000-0000-0000-000000000104', 'visitor:crossvisit-reader-c', '960001', '96000000-0000-0000-0000-000000000001', 'episode_read_10s', 'episode-cross-c-2', 2, now()-interval '2 days'+interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);

do $$
declare
 v_impressions bigint;
 v_first bigint;
 v_second bigint;
 v_rate numeric;
 v_trend_first bigint;
 v_trend_second bigint;
 v_daily_first bigint;
 v_daily_second bigint;
begin
  select impressions, first_episode_reads_10s, continued_to_episode_2, episode1_to_episode2_rate_pct
    into v_impressions, v_first, v_second, v_rate
    from public.novelight_author_exposure_funnel_v2(30);
  if v_impressions <> 4 or v_first <> 2 or v_second <> 1 or v_rate <> 50 then
    raise exception 'Free cross-visit cohort expected 4 impressions, 2 first, 1 continued, 50%%; got %,%,%,%',
      v_impressions, v_first, v_second, v_rate;
  end if;

  select max(current_first_episode_reads_10s), max(current_continued_to_episode_2),
         sum(first_episode_reads_10s), sum(continued_to_episode_2)
    into v_trend_first, v_trend_second, v_daily_first, v_daily_second
    from public.novelight_author_analytics_timeseries(30);
  if v_trend_first <> 2 or v_trend_second <> 1 or v_daily_first <> 2 or v_daily_second <> 1 then
    raise exception 'Trend totals and buckets should match cross-visit cohort: %,%,%,%',
      v_trend_first, v_trend_second, v_daily_first, v_daily_second;
  end if;
end $$;

reset role;
update public.profiles set plan='standard'
 where id='96000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
do $$
declare v_rows integer; v_work text; v_first bigint; v_second bigint;
begin
  select count(*)::integer, max(novel_id), max(first_episode_reads_10s), max(continued_to_episode_2)
  into v_rows,v_work,v_first,v_second
  from public.novelight_author_exposure_funnel_v2(30);
  if v_rows<>1 or v_work<>'960001' or v_first<>2 or v_second<>1 then
    raise exception 'Standard per-work cohort mismatch: %,%,%,%',v_rows,v_work,v_first,v_second;
  end if;
end $$;
reset role;
rollback;

select 'PASS: cross-visit episode retention counts same viewer across 16 days, excludes readers with only episode 2, and respects Free/Standard entitlement' as result;
