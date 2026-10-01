-- NOVELIGHT admin analytics foundation.
-- This migration intentionally does not infer unavailable historical publication timestamps.

alter table public.contact_inquiries
  add column if not exists category text not null default 'general';

alter table public.episodes
  add column if not exists first_published_at timestamptz;

create or replace function public.novelight_capture_episode_first_published_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'published'
     and new.first_published_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.first_published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists episodes_capture_first_published_at on public.episodes;
create trigger episodes_capture_first_published_at
before insert or update of status on public.episodes
for each row execute function public.novelight_capture_episode_first_published_at();

comment on column public.episodes.first_published_at is
  'Exact first publication time captured from this migration forward. Existing published episodes are intentionally left NULL.';

create table if not exists public.admin_metrics_daily (
  metric_date date primary key,
  unique_visitors bigint not null default 0,
  pageviews bigint not null default 0,
  logged_in_users bigint not null default 0,
  new_users bigint not null default 0,
  new_authors bigint not null default 0,
  new_readers bigint not null default 0,
  novels_created bigint not null default 0,
  episodes_published bigint not null default 0,
  reading_users bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on column public.admin_metrics_daily.pageviews is
  'Counted episode page views from episode_pv_events. This is not inferred as whole-site page views.';

alter table public.admin_metrics_daily enable row level security;
revoke all on table public.admin_metrics_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_metrics_daily to service_role;

create index if not exists beta_activity_date_idx
  on public.beta_activity_days (activity_date);
create index if not exists reader_journey_type_recent_idx
  on public.reader_journey_events (event_type, occurred_at desc);
create index if not exists episode_pv_counted_at_idx
  on public.episode_pv_events (counted_at desc);
create index if not exists user_lifecycle_registered_at_idx
  on public.user_lifecycle (registered_at desc);
create index if not exists novels_created_at_idx
  on public.novels (created_at desc);
create index if not exists novels_status_pv_idx
  on public.novels (status, pv);
create index if not exists episodes_first_published_at_idx
  on public.episodes (first_published_at desc)
  where first_published_at is not null;
create index if not exists contact_inquiries_status_created_idx
  on public.contact_inquiries (status, created_at desc);
create index if not exists contact_inquiries_category_created_idx
  on public.contact_inquiries (category, created_at desc);

create or replace function public.novelight_admin_refresh_metrics_daily(
  p_from_date date,
  p_to_date date
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from date := greatest(p_from_date, date '2026-08-23');
  v_to date := least(p_to_date, (now() at time zone 'Asia/Tokyo')::date);
  v_rows integer := 0;
begin
  if p_from_date is null or p_to_date is null or v_from > v_to then
    return 0;
  end if;

  with dates as materialized (
    select d::date as metric_date
    from generate_series(v_from, v_to, interval '1 day') d
  ),
  traffic as materialized (
    select
      b.activity_date as metric_date,
      count(distinct b.viewer_key_hash)::bigint as unique_visitors,
      count(distinct b.user_id) filter (where b.user_id is not null)::bigint as logged_in_users
    from public.beta_activity_days b
    where b.activity_date between v_from and v_to
    group by b.activity_date
  ),
  pageviews as materialized (
    select
      (e.counted_at at time zone 'Asia/Tokyo')::date as metric_date,
      count(*)::bigint as pageviews
    from public.episode_pv_events e
    where e.counted_at >= (v_from::timestamp at time zone 'Asia/Tokyo')
      and e.counted_at < ((v_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by 1
  ),
  registrations as materialized (
    select
      (u.registered_at at time zone 'Asia/Tokyo')::date as metric_date,
      count(*)::bigint as new_users
    from public.user_lifecycle u
    where u.registered_at >= (v_from::timestamp at time zone 'Asia/Tokyo')
      and u.registered_at < ((v_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by 1
  ),
  first_author_dates as materialized (
    select n.user_id, min((n.created_at at time zone 'Asia/Tokyo')::date) as first_date
    from public.novels n
    where n.user_id is not null
    group by n.user_id
  ),
  new_authors as materialized (
    select first_date as metric_date, count(*)::bigint as new_authors
    from first_author_dates
    where first_date between v_from and v_to
    group by first_date
  ),
  first_reader_dates as materialized (
    select r.viewer_key_hash, min((r.occurred_at at time zone 'Asia/Tokyo')::date) as first_date
    from public.reader_journey_events r
    where r.event_type = 'episode_read_10s'
    group by r.viewer_key_hash
  ),
  new_readers as materialized (
    select first_date as metric_date, count(*)::bigint as new_readers
    from first_reader_dates
    where first_date between v_from and v_to
    group by first_date
  ),
  novels_created as materialized (
    select
      (n.created_at at time zone 'Asia/Tokyo')::date as metric_date,
      count(*)::bigint as novels_created
    from public.novels n
    where n.created_at >= (v_from::timestamp at time zone 'Asia/Tokyo')
      and n.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by 1
  ),
  episodes_published as materialized (
    select
      (e.first_published_at at time zone 'Asia/Tokyo')::date as metric_date,
      count(*)::bigint as episodes_published
    from public.episodes e
    where e.first_published_at is not null
      and e.first_published_at >= (v_from::timestamp at time zone 'Asia/Tokyo')
      and e.first_published_at < ((v_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by 1
  ),
  reading as materialized (
    select
      (r.occurred_at at time zone 'Asia/Tokyo')::date as metric_date,
      count(distinct r.viewer_key_hash)::bigint as reading_users
    from public.reader_journey_events r
    where r.event_type = 'episode_read_10s'
      and r.occurred_at >= (v_from::timestamp at time zone 'Asia/Tokyo')
      and r.occurred_at < ((v_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by 1
  )
  insert into public.admin_metrics_daily (
    metric_date,
    unique_visitors,
    pageviews,
    logged_in_users,
    new_users,
    new_authors,
    new_readers,
    novels_created,
    episodes_published,
    reading_users,
    updated_at
  )
  select
    d.metric_date,
    coalesce(t.unique_visitors, 0),
    coalesce(p.pageviews, 0),
    coalesce(t.logged_in_users, 0),
    coalesce(reg.new_users, 0),
    coalesce(na.new_authors, 0),
    coalesce(nr.new_readers, 0),
    coalesce(nc.novels_created, 0),
    coalesce(ep.episodes_published, 0),
    coalesce(rd.reading_users, 0),
    now()
  from dates d
  left join traffic t using (metric_date)
  left join pageviews p using (metric_date)
  left join registrations reg using (metric_date)
  left join new_authors na using (metric_date)
  left join new_readers nr using (metric_date)
  left join novels_created nc using (metric_date)
  left join episodes_published ep using (metric_date)
  left join reading rd using (metric_date)
  on conflict (metric_date) do update set
    unique_visitors = excluded.unique_visitors,
    pageviews = excluded.pageviews,
    logged_in_users = excluded.logged_in_users,
    new_users = excluded.new_users,
    new_authors = excluded.new_authors,
    new_readers = excluded.new_readers,
    novels_created = excluded.novels_created,
    episodes_published = excluded.episodes_published,
    reading_users = excluded.reading_users,
    updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.novelight_admin_refresh_metrics_daily(date, date)
  from public, anon, authenticated;
grant execute on function public.novelight_admin_refresh_metrics_daily(date, date)
  to service_role;

-- Backfill only data that is actually timestamped. Existing published episodes remain
-- uncounted until first_published_at starts being captured by this migration.
select public.novelight_admin_refresh_metrics_daily(
  date '2026-08-23',
  (now() at time zone 'Asia/Tokyo')::date
);
