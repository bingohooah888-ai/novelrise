-- NOVELIGHT reader-growth attribution.
--
-- Adds three isolated capabilities without changing SCOUT XP / Point / Rank:
-- 1) private reader share links for published works,
-- 2) attribution only after the recipient creates an authoritative valid_read,
-- 3) source-level D1/D7/D30 retention for ADMIN analytics.
--
-- Share attribution is informational only. It never writes scout_event_ledger,
-- scout_xp_ledger, scout_point_ledger, work Rank, LIGHT SEED, PV, or exposure.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261002113000')
);

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.valid_read_events') is null
     or to_regclass('public.user_acquisition') is null
     or to_regclass('public.user_lifecycle') is null
     or to_regclass('public.beta_activity_days') is null then
    raise exception 'reader-growth attribution prerequisites are missing';
  end if;
end
$$;

create table public.scout_share_links (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_user_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  last_shared_at timestamptz not null default pg_catalog.now(),
  constraint scout_share_links_owner_novel_once unique (owner_user_id, novel_id)
);

comment on table public.scout_share_links is
  'Private attribution links for readers sharing published works. The opaque UUID may appear in a public share URL; owner identity is never encoded in the URL.';

create index scout_share_links_owner_recent_idx
  on public.scout_share_links (owner_user_id, last_shared_at desc);
create index scout_share_links_novel_idx
  on public.scout_share_links (novel_id);

alter table public.scout_share_links enable row level security;
revoke all on table public.scout_share_links from public, anon, authenticated, service_role;

create table public.scout_share_claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  share_link_id uuid not null references public.scout_share_links(id) on delete cascade,
  recipient_user_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  claimed_at timestamptz not null default pg_catalog.now(),
  constraint scout_share_claims_recipient_novel_once unique (recipient_user_id, novel_id)
);

comment on table public.scout_share_claims is
  'Private first-touch attribution claims. A claim becomes a discovery only when a later authoritative valid_read exists for the same recipient/work.';

create index scout_share_claims_link_recent_idx
  on public.scout_share_claims (share_link_id, claimed_at desc);
create index scout_share_claims_recipient_novel_idx
  on public.scout_share_claims (recipient_user_id, novel_id, claimed_at);

alter table public.scout_share_claims enable row level security;
revoke all on table public.scout_share_claims from public, anon, authenticated, service_role;

create or replace function public.novelight_scout_share_link(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id = p_novel_id
     and n.status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'not_published');
  end if;

  -- Sharing your own work remains covered by author attribution, not SCOUT.
  if v_author_id = v_uid then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'own_work');
  end if;

  insert into public.scout_share_links (
    owner_user_id,
    novel_id,
    created_at,
    last_shared_at
  ) values (
    v_uid,
    p_novel_id,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (owner_user_id, novel_id) do update
    set last_shared_at = excluded.last_shared_at
  returning id into v_link_id;

  return pg_catalog.jsonb_build_object(
    'eligible', true,
    'token', v_link_id::text
  );
end
$$;

revoke all on function public.novelight_scout_share_link(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_scout_share_link(bigint)
  to authenticated;

create or replace function public.novelight_claim_scout_share(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token uuid;
  v_owner uuid;
  v_author uuid;
  v_novel_id bigint;
  v_inserted integer := 0;
begin
  if v_uid is null then
    return false;
  end if;

  if p_token is null
     or p_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_token := p_token::uuid;

  select l.owner_user_id, n.user_id, n.id
    into v_owner, v_author, v_novel_id
    from public.scout_share_links l
    join public.novels n on n.id = l.novel_id
   where l.id = v_token
     and n.status = 'published';

  if not found or v_uid = v_owner or v_uid = v_author then
    return false;
  end if;

  insert into public.scout_share_claims (
    share_link_id,
    recipient_user_id,
    novel_id,
    claimed_at
  ) values (
    v_token,
    v_uid,
    v_novel_id,
    pg_catalog.now()
  )
  on conflict (recipient_user_id, novel_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1 or exists (
    select 1
      from public.scout_share_claims c
     where c.recipient_user_id = v_uid
       and c.novel_id = v_novel_id
       and c.share_link_id = v_token
  );
end
$$;

revoke all on function public.novelight_claim_scout_share(text)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_claim_scout_share(text)
  to authenticated;

create or replace function public.novelight_scout_share_attribution(
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ), owned_links as materialized (
    select l.id, l.novel_id
      from public.scout_share_links l, me
     where me.uid is not null
       and l.owner_user_id = me.uid
  ), attributed as materialized (
    select
      c.id as claim_id,
      c.novel_id,
      c.recipient_user_id,
      min(v.qualified_at) as discovered_at
    from public.scout_share_claims c
    join owned_links l on l.id = c.share_link_id
    join public.valid_read_events v
      on v.reader_id = c.recipient_user_id
     and v.novel_id_snapshot = c.novel_id::text
     and v.qualified_at >= c.claimed_at
     and v.foreground_signal
     and (v.progress_signal or v.interaction_signal)
    group by c.id, c.novel_id, c.recipient_user_id
  ), work_rows as (
    select
      a.novel_id,
      n.title,
      count(distinct a.recipient_user_id)::bigint as discovered_readers,
      max(a.discovered_at) as latest_discovery_at
    from attributed a
    join public.novels n on n.id = a.novel_id
    group by a.novel_id, n.title
    order by discovered_readers desc, latest_discovery_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  select case
    when (select uid from me) is null then
      pg_catalog.jsonb_build_object(
        'authenticated', false,
        'discoveredReaders', 0,
        'works', '[]'::jsonb
      )
    else
      pg_catalog.jsonb_build_object(
        'authenticated', true,
        'discoveredReaders', (
          select count(distinct a.recipient_user_id)::bigint from attributed a
        ),
        'works', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'novelId', w.novel_id,
              'title', w.title,
              'discoveredReaders', w.discovered_readers,
              'latestDiscoveryAt', w.latest_discovery_at
            )
            order by w.discovered_readers desc, w.latest_discovery_at desc
          )
          from work_rows w
        ), '[]'::jsonb),
        'scoringImpact', false
      )
  end
$$;

revoke all on function public.novelight_scout_share_attribution(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_scout_share_attribution(integer)
  to authenticated;

create or replace function public.novelight_admin_acquisition_retention(
  p_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      case when p_days in (7, 30, 90) then p_days else 30 end as days,
      (pg_catalog.now() at time zone 'Asia/Tokyo')::date as end_date
  ), bounds as (
    select
      days,
      end_date,
      end_date - (days - 1) as start_date,
      ((end_date - (days - 1))::timestamp at time zone 'Asia/Tokyo') as start_ts,
      ((end_date + 1)::timestamp at time zone 'Asia/Tokyo') as end_ts
    from params
  ), cohorts as materialized (
    select
      u.user_id,
      coalesce(nullif(u.source, ''), 'direct') as source,
      (l.registered_at at time zone 'Asia/Tokyo')::date as cohort_date
    from public.user_acquisition u
    join public.user_lifecycle l on l.user_id = u.user_id
    cross join bounds b
    where u.first_touched_at >= b.start_ts
      and u.first_touched_at < b.end_ts
  ), source_rows as (
    select
      c.source,
      count(*)::bigint as registered_cohort,
      count(*) filter (where c.cohort_date <= b.end_date - 1)::bigint as d1_eligible,
      count(*) filter (
        where c.cohort_date <= b.end_date - 1
          and exists (
            select 1 from public.beta_activity_days a
             where a.user_id = c.user_id
               and a.activity_date = c.cohort_date + 1
          )
      )::bigint as d1_retained,
      count(*) filter (where c.cohort_date <= b.end_date - 7)::bigint as d7_eligible,
      count(*) filter (
        where c.cohort_date <= b.end_date - 7
          and exists (
            select 1 from public.beta_activity_days a
             where a.user_id = c.user_id
               and a.activity_date = c.cohort_date + 7
          )
      )::bigint as d7_retained,
      count(*) filter (where c.cohort_date <= b.end_date - 30)::bigint as d30_eligible,
      count(*) filter (
        where c.cohort_date <= b.end_date - 30
          and exists (
            select 1 from public.beta_activity_days a
             where a.user_id = c.user_id
               and a.activity_date = c.cohort_date + 30
          )
      )::bigint as d30_retained
    from cohorts c
    cross join bounds b
    group by c.source
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'source', s.source,
      'registeredCohort', s.registered_cohort,
      'd1Eligible', s.d1_eligible,
      'd1Retained', s.d1_retained,
      'd1Rate', case when s.d1_eligible > 0 then pg_catalog.round(100.0 * s.d1_retained / s.d1_eligible, 1) else null end,
      'd7Eligible', s.d7_eligible,
      'd7Retained', s.d7_retained,
      'd7Rate', case when s.d7_eligible > 0 then pg_catalog.round(100.0 * s.d7_retained / s.d7_eligible, 1) else null end,
      'd30Eligible', s.d30_eligible,
      'd30Retained', s.d30_retained,
      'd30Rate', case when s.d30_eligible > 0 then pg_catalog.round(100.0 * s.d30_retained / s.d30_eligible, 1) else null end
    ) order by s.registered_cohort desc, s.source
  ), '[]'::jsonb)
  from source_rows s
$$;

revoke all on function public.novelight_admin_acquisition_retention(integer)
  from public, anon, authenticated;
grant execute on function public.novelight_admin_acquisition_retention(integer)
  to service_role;

create or replace function public.novelight_admin_scout_share_snapshot(
  p_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      case when p_days in (7, 30, 90) then p_days else 30 end as days,
      (pg_catalog.now() at time zone 'Asia/Tokyo')::date as end_date
  ), bounds as (
    select
      ((end_date - (days - 1))::timestamp at time zone 'Asia/Tokyo') as start_ts,
      ((end_date + 1)::timestamp at time zone 'Asia/Tokyo') as end_ts
    from params
  ), claims as materialized (
    select c.*, l.owner_user_id
      from public.scout_share_claims c
      join public.scout_share_links l on l.id = c.share_link_id
      cross join bounds b
     where c.claimed_at >= b.start_ts and c.claimed_at < b.end_ts
  ), attributed as materialized (
    select
      c.id as claim_id,
      c.owner_user_id,
      c.recipient_user_id,
      c.novel_id,
      min(v.qualified_at) as discovered_at
    from claims c
    join public.valid_read_events v
      on v.reader_id = c.recipient_user_id
     and v.novel_id_snapshot = c.novel_id::text
     and v.qualified_at >= c.claimed_at
     and v.foreground_signal
     and (v.progress_signal or v.interaction_signal)
    group by c.id, c.owner_user_id, c.recipient_user_id, c.novel_id
  ), work_rows as (
    select
      a.novel_id,
      n.title,
      count(distinct a.recipient_user_id)::bigint as discovered_readers
    from attributed a
    join public.novels n on n.id = a.novel_id
    group by a.novel_id, n.title
    order by discovered_readers desc
    limit 20
  )
  select pg_catalog.jsonb_build_object(
    'claimedReaders', (select count(distinct c.recipient_user_id)::bigint from claims c),
    'discoveredReaders', (select count(distinct a.recipient_user_id)::bigint from attributed a),
    'conversionRate', coalesce((
      select pg_catalog.round(
        100.0 * count(distinct a.recipient_user_id)
        / nullif((select count(distinct c.recipient_user_id) from claims c), 0),
        1
      ) from attributed a
    ), 0),
    'topWorks', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'novelId', w.novel_id,
          'title', w.title,
          'discoveredReaders', w.discovered_readers
        ) order by w.discovered_readers desc
      ) from work_rows w
    ), '[]'::jsonb),
    'scoringImpact', false
  )
$$;

revoke all on function public.novelight_admin_scout_share_snapshot(integer)
  from public, anon, authenticated;
grant execute on function public.novelight_admin_scout_share_snapshot(integer)
  to service_role;

comment on function public.novelight_scout_share_attribution(integer) is
  'Owner-private informational attribution only. Does not alter SCOUT XP, Point, Rank, LIGHT SEED, work Rank, PV, or exposure.';

commit;
