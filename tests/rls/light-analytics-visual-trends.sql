\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values (
  '95000000-0000-0000-0000-000000000001',
  '{"display_name":"Analytics Trend Author"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, plan)
values (
  '95000000-0000-0000-0000-000000000001',
  'Analytics Trend Author',
  'free'
)
on conflict (id) do update
set display_name = excluded.display_name,
    plan = excluded.plan;

insert into public.novel_exposure_events (
  id,
  viewer_key,
  viewer_id,
  surface,
  novel_id_snapshot,
  author_id_snapshot,
  plan_snapshot,
  rule_version,
  exposed_at,
  exposure_hour,
  allocation_reason
) values
  (
    '95000000-0000-0000-0000-000000000101',
    'visitor:analytics-trend-current-rich',
    null,
    'home_discovery',
    '950001',
    '95000000-0000-0000-0000-000000000001',
    'free',
    'analytics-trend-test',
    now() - interval '1 day',
    date_trunc('hour', now() - interval '1 day'),
    'balanced'
  ),
  (
    '95000000-0000-0000-0000-000000000102',
    'visitor:analytics-trend-current-view',
    null,
    'home_discovery',
    '950002',
    '95000000-0000-0000-0000-000000000001',
    'free',
    'analytics-trend-test',
    now() - interval '2 days',
    date_trunc('hour', now() - interval '2 days'),
    'balanced'
  ),
  (
    '95000000-0000-0000-0000-000000000103',
    'visitor:analytics-trend-previous',
    null,
    'home_discovery',
    '950003',
    '95000000-0000-0000-0000-000000000001',
    'free',
    'analytics-trend-test',
    now() - interval '8 days',
    date_trunc('hour', now() - interval '8 days'),
    'balanced'
  );

insert into public.novel_exposure_conversions (
  id,
  exposure_id,
  viewer_key_snapshot,
  novel_id_snapshot,
  author_id_snapshot,
  event_type,
  episode_id_snapshot,
  episode_number_snapshot,
  converted_at
) values
  (
    '95000000-0000-0000-0000-000000000201',
    '95000000-0000-0000-0000-000000000101',
    'visitor:analytics-trend-current-rich',
    '950001',
    '95000000-0000-0000-0000-000000000001',
    'detail_open',
    null,
    null,
    now() - interval '1 day' + interval '1 minute'
  ),
  (
    '95000000-0000-0000-0000-000000000202',
    '95000000-0000-0000-0000-000000000101',
    'visitor:analytics-trend-current-rich',
    '950001',
    '95000000-0000-0000-0000-000000000001',
    'episode_read_10s',
    'episode-trend-current-1',
    1,
    now() - interval '1 day' + interval '2 minutes'
  ),
  (
    '95000000-0000-0000-0000-000000000203',
    '95000000-0000-0000-0000-000000000101',
    'visitor:analytics-trend-current-rich',
    '950001',
    '95000000-0000-0000-0000-000000000001',
    'episode_read_10s',
    'episode-trend-current-2',
    2,
    now() - interval '1 day' + interval '3 minutes'
  ),
  (
    '95000000-0000-0000-0000-000000000204',
    '95000000-0000-0000-0000-000000000101',
    'visitor:analytics-trend-current-rich',
    '950001',
    '95000000-0000-0000-0000-000000000001',
    'favorite_added',
    null,
    null,
    now() - interval '1 day' + interval '4 minutes'
  ),
  (
    '95000000-0000-0000-0000-000000000205',
    '95000000-0000-0000-0000-000000000103',
    'visitor:analytics-trend-previous',
    '950003',
    '95000000-0000-0000-0000-000000000001',
    'detail_open',
    null,
    null,
    now() - interval '8 days' + interval '1 minute'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '95000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  v_rows integer;
  v_daily_impressions bigint;
  v_daily_details bigint;
  v_current_impressions bigint;
  v_current_details bigint;
  v_current_first bigint;
  v_current_second bigint;
  v_current_favorites bigint;
  v_previous_impressions bigint;
  v_previous_details bigint;
begin
  select
    count(*)::integer,
    sum(t.impressions)::bigint,
    sum(t.detail_opens)::bigint,
    max(t.current_impressions),
    max(t.current_detail_opens),
    max(t.current_first_episode_reads_10s),
    max(t.current_continued_to_episode_2),
    max(t.current_favorites),
    max(t.previous_impressions),
    max(t.previous_detail_opens)
  into
    v_rows,
    v_daily_impressions,
    v_daily_details,
    v_current_impressions,
    v_current_details,
    v_current_first,
    v_current_second,
    v_current_favorites,
    v_previous_impressions,
    v_previous_details
  from public.novelight_author_analytics_timeseries(7) t;

  if v_rows <> 7 then
    raise exception 'Trend RPC must return exactly one row per requested day; rows=%', v_rows;
  end if;

  if v_daily_impressions <> 2 or v_daily_details <> 1 then
    raise exception
      'Current daily buckets must sum to the rolling current window; impressions=%, details=%',
      v_daily_impressions,
      v_daily_details;
  end if;

  if v_current_impressions <> 2
     or v_current_details <> 1
     or v_current_first <> 1
     or v_current_second <> 1
     or v_current_favorites <> 1 then
    raise exception
      'Current LIGHT ANALYTICS totals are wrong: impressions=%, details=%, first=%, second=%, favorites=%',
      v_current_impressions,
      v_current_details,
      v_current_first,
      v_current_second,
      v_current_favorites;
  end if;

  if v_previous_impressions <> 1 or v_previous_details <> 1 then
    raise exception
      'Previous-period totals are wrong: impressions=%, details=%',
      v_previous_impressions,
      v_previous_details;
  end if;
end
$$;

reset role;
rollback;

select 'PASS: LIGHT ANALYTICS visual trends preserve aggregate current and prior-period semantics' as result;