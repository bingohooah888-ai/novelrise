-- NOVELIGHT beta-launch data foundations.
-- Adds immutable/pseudonymous ledgers needed from day one of beta:
-- content classification, moderation reports, acquisition, return visits,
-- reader journey events, Founding Authors, and subscription event history.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823170000'));

-- ---------------------------------------------------------------------------
-- Work classification and zoning
-- Existing pre-beta works remain `unspecified` until the author confirms them.
-- New published works must explicitly classify AI use and acknowledge the
-- current content policy. This avoids silently inventing classifications for
-- historical/dev data.
-- ---------------------------------------------------------------------------
alter table public.novels
  add column ai_usage text not null default 'unspecified',
  add column content_rating text not null default 'general',
  add column content_warnings text[] not null default '{}'::text[],
  add column content_policy_ack boolean not null default false,
  add column content_policy_version text;

alter table public.novels
  add constraint novels_ai_usage_check
  check (ai_usage in ('unspecified', 'human', 'ai_assisted', 'ai_generated'));

alter table public.novels
  add constraint novels_content_rating_check
  check (content_rating in ('general', 'mature'));

create or replace function public.enforce_novel_beta_classification()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'published' then
    if new.ai_usage = 'unspecified' then
      raise exception using
        errcode = '23514',
        message = '公開作品はAI利用区分を選択してください';
    end if;

    if not new.content_policy_ack
       or new.content_policy_version is null
       or btrim(new.content_policy_version) = '' then
      raise exception using
        errcode = '23514',
        message = '公開前に投稿ガイドラインの確認が必要です';
    end if;

    if new.content_rating = 'mature'
       and cardinality(new.content_warnings) = 0 then
      raise exception using
        errcode = '23514',
        message = '成熟したテーマを含む作品には内容警告を1つ以上設定してください';
    end if;
  end if;

  return new;
end
$$;

create trigger novels_beta_classification_guard
before insert or update of status, ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version
on public.novels
for each row
execute function public.enforce_novel_beta_classification();

-- ---------------------------------------------------------------------------
-- Moderation / reporting
-- Raw report rows are operator-only. Public clients can submit only through a
-- validated SECURITY DEFINER function and cannot enumerate reports.
-- ---------------------------------------------------------------------------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid,
  visitor_key_hash text not null,
  novel_id_snapshot text not null,
  episode_id_snapshot text,
  author_id_snapshot uuid not null,
  category text not null check (
    category in (
      'copyright',
      'prohibited_content',
      'harassment',
      'spam',
      'ai_misclassification',
      'other'
    )
  ),
  details text not null,
  status text not null default 'new' check (
    status in ('new', 'reviewing', 'resolved', 'dismissed')
  ),
  created_at timestamptz not null default now(),
  constraint content_reports_visitor_hash_length check (char_length(visitor_key_hash) = 32),
  constraint content_reports_details_length check (char_length(details) between 5 and 4000)
);

create index content_reports_status_created_idx
  on public.content_reports (status, created_at desc);
create index content_reports_novel_created_idx
  on public.content_reports (novel_id_snapshot, created_at desc);
create index content_reports_visitor_rate_idx
  on public.content_reports (visitor_key_hash, created_at desc);

alter table public.content_reports enable row level security;
revoke all on table public.content_reports from public, anon, authenticated;

create or replace function public.submit_content_report(
  p_novel_id text,
  p_episode_id text,
  p_category text,
  p_details text,
  p_visitor_token text,
  p_website text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_author_id uuid;
  v_details text := btrim(coalesce(p_details, ''));
  v_recent integer;
  v_id uuid;
begin
  -- Honeypot: silently accept without storing.
  if char_length(btrim(coalesce(p_website, ''))) > 0 then
    return null;
  end if;

  if p_category not in (
    'copyright', 'prohibited_content', 'harassment', 'spam',
    'ai_misclassification', 'other'
  ) then
    raise exception using errcode = '22023', message = '通報理由を確認してください';
  end if;

  if char_length(v_details) not between 5 and 4000 then
    raise exception using errcode = '22023', message = '通報内容は5文字以上4000文字以内で入力してください';
  end if;

  if char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = '送信情報を確認できませんでした';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '通報対象の公開作品が見つかりません';
  end if;

  if p_episode_id is not null and not exists (
    select 1
      from public.episodes e
     where e.id::text = p_episode_id
       and e.novel_id::text = p_novel_id
       and e.status = 'published'
  ) then
    raise exception using errcode = '23514', message = '通報対象のエピソードが見つかりません';
  end if;

  v_hash := md5(v_token);

  select count(*)::integer
    into v_recent
    from public.content_reports r
   where r.created_at >= now() - interval '1 hour'
     and (
       r.visitor_key_hash = v_hash
       or (v_uid is not null and r.reporter_id = v_uid)
     );

  if v_recent >= 5 then
    raise exception using errcode = 'P0001', message = '短時間に送信できる通報数を超えました';
  end if;

  insert into public.content_reports (
    reporter_id,
    visitor_key_hash,
    novel_id_snapshot,
    episode_id_snapshot,
    author_id_snapshot,
    category,
    details
  ) values (
    v_uid,
    v_hash,
    p_novel_id,
    p_episode_id,
    v_author_id,
    p_category,
    v_details
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.submit_content_report(text, text, text, text, text, text) from public;
grant execute on function public.submit_content_report(text, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Acquisition attribution. Store only campaign metadata and a one-way hash of
-- the random visitor token; do not store X account data or raw referrer URLs.
-- ---------------------------------------------------------------------------
create table public.acquisition_touches (
  id uuid primary key default gen_random_uuid(),
  visitor_key_hash text not null,
  user_id uuid,
  source text not null,
  medium text,
  campaign text,
  content text,
  landing_path text not null,
  referrer_host text,
  touched_at timestamptz not null default now(),
  constraint acquisition_touch_hash_length check (char_length(visitor_key_hash) = 32)
);

create index acquisition_touches_visitor_idx
  on public.acquisition_touches (visitor_key_hash, touched_at);
create index acquisition_touches_user_idx
  on public.acquisition_touches (user_id, touched_at)
  where user_id is not null;

alter table public.acquisition_touches enable row level security;
revoke all on table public.acquisition_touches from public, anon, authenticated;

create table public.user_acquisition (
  user_id uuid primary key,
  first_touch_id uuid not null references public.acquisition_touches(id) on delete restrict,
  first_visitor_key_hash text not null,
  source text not null,
  medium text,
  campaign text,
  content text,
  landing_path text not null,
  first_touched_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  constraint user_acquisition_hash_length check (char_length(first_visitor_key_hash) = 32)
);

alter table public.user_acquisition enable row level security;
revoke all on table public.user_acquisition from public, anon, authenticated;

grant select on table public.user_acquisition to authenticated;
create policy user_acquisition_select_own
on public.user_acquisition
for select
to authenticated
using (user_id = (select auth.uid()));

create table public.user_lifecycle (
  user_id uuid primary key,
  registered_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.user_lifecycle enable row level security;
revoke all on table public.user_lifecycle from public, anon, authenticated;

grant select on table public.user_lifecycle to authenticated;
create policy user_lifecycle_select_own
on public.user_lifecycle
for select
to authenticated
using (user_id = (select auth.uid()));

create or replace function public.record_acquisition_touch(
  p_visitor_token text,
  p_source text,
  p_medium text default null,
  p_campaign text default null,
  p_content text default null,
  p_landing_path text default '/',
  p_referrer_host text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_source text := lower(btrim(coalesce(nullif(p_source, ''), 'direct')));
  v_recent integer;
  v_id uuid;
begin
  if char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'Visitor token is invalid';
  end if;

  if char_length(v_source) > 40
     or char_length(coalesce(p_medium, '')) > 80
     or char_length(coalesce(p_campaign, '')) > 120
     or char_length(coalesce(p_content, '')) > 120
     or char_length(coalesce(p_landing_path, '/')) > 500
     or char_length(coalesce(p_referrer_host, '')) > 255 then
    raise exception using errcode = '22023', message = 'Acquisition metadata is too long';
  end if;

  v_hash := md5(v_token);

  select count(*)::integer into v_recent
    from public.acquisition_touches t
   where t.visitor_key_hash = v_hash
     and t.touched_at >= now() - interval '10 minutes';

  if v_recent >= 20 then
    raise exception using errcode = 'P0001', message = 'Too many acquisition events';
  end if;

  insert into public.acquisition_touches (
    visitor_key_hash,
    user_id,
    source,
    medium,
    campaign,
    content,
    landing_path,
    referrer_host
  ) values (
    v_hash,
    v_uid,
    v_source,
    nullif(btrim(coalesce(p_medium, '')), ''),
    nullif(btrim(coalesce(p_campaign, '')), ''),
    nullif(btrim(coalesce(p_content, '')), ''),
    coalesce(nullif(btrim(coalesce(p_landing_path, '')), ''), '/'),
    nullif(lower(btrim(coalesce(p_referrer_host, ''))), '')
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.record_acquisition_touch(text, text, text, text, text, text, text) from public;
grant execute on function public.record_acquisition_touch(text, text, text, text, text, text, text)
  to anon, authenticated;

create or replace function public.claim_user_acquisition(p_visitor_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_touch public.acquisition_touches%rowtype;
  v_registered_at timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'Visitor token is invalid';
  end if;

  begin
    select u.created_at into v_registered_at
      from auth.users u
     where u.id = v_uid;
  exception
    when undefined_table then
      v_registered_at := now();
  end;

  if v_registered_at is null then
    v_registered_at := now();
  end if;

  insert into public.user_lifecycle (user_id, registered_at, first_seen_at, last_seen_at)
  values (v_uid, v_registered_at, now(), now())
  on conflict (user_id) do update
    set last_seen_at = greatest(public.user_lifecycle.last_seen_at, excluded.last_seen_at);

  if exists (select 1 from public.user_acquisition a where a.user_id = v_uid) then
    return false;
  end if;

  v_hash := md5(v_token);

  select t.* into v_touch
    from public.acquisition_touches t
   where t.visitor_key_hash = v_hash
     and t.touched_at >= now() - interval '90 days'
   order by t.touched_at asc, t.id asc
   limit 1;

  if not found then
    return false;
  end if;

  update public.acquisition_touches
     set user_id = v_uid
   where visitor_key_hash = v_hash
     and user_id is null;

  insert into public.user_acquisition (
    user_id,
    first_touch_id,
    first_visitor_key_hash,
    source,
    medium,
    campaign,
    content,
    landing_path,
    first_touched_at
  ) values (
    v_uid,
    v_touch.id,
    v_hash,
    v_touch.source,
    v_touch.medium,
    v_touch.campaign,
    v_touch.content,
    v_touch.landing_path,
    v_touch.touched_at
  )
  on conflict (user_id) do nothing;

  return true;
end
$$;

revoke all on function public.claim_user_acquisition(text) from public, anon;
grant execute on function public.claim_user_acquisition(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily visits for 7/30-day return/retention measurement.
-- ---------------------------------------------------------------------------
create table public.beta_activity_days (
  viewer_key_hash text not null,
  user_id uuid,
  activity_date date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  visit_count integer not null default 1 check (visit_count > 0),
  first_path text not null,
  latest_path text not null,
  source text not null,
  primary key (viewer_key_hash, activity_date),
  constraint beta_activity_hash_length check (char_length(viewer_key_hash) = 32)
);

create index beta_activity_user_date_idx
  on public.beta_activity_days (user_id, activity_date)
  where user_id is not null;

alter table public.beta_activity_days enable row level security;
revoke all on table public.beta_activity_days from public, anon, authenticated;

create or replace function public.record_beta_visit(
  p_visitor_token text,
  p_path text default '/',
  p_source text default 'direct'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_date date := timezone('Asia/Tokyo', now())::date;
  v_path text := coalesce(nullif(btrim(coalesce(p_path, '')), ''), '/');
  v_source text := lower(coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'direct'));
begin
  if char_length(v_path) > 500 or char_length(v_source) > 40 then
    raise exception using errcode = '22023', message = 'Visit metadata is too long';
  end if;

  if v_uid is not null then
    v_hash := md5('user:' || v_uid::text);
  else
    if char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := md5('visitor:' || v_token);
  end if;

  insert into public.beta_activity_days (
    viewer_key_hash,
    user_id,
    activity_date,
    first_seen_at,
    last_seen_at,
    visit_count,
    first_path,
    latest_path,
    source
  ) values (
    v_hash,
    v_uid,
    v_date,
    now(),
    now(),
    1,
    v_path,
    v_path,
    v_source
  )
  on conflict (viewer_key_hash, activity_date) do update
    set last_seen_at = excluded.last_seen_at,
        visit_count = public.beta_activity_days.visit_count + 1,
        latest_path = excluded.latest_path,
        user_id = coalesce(public.beta_activity_days.user_id, excluded.user_id),
        source = case
          when public.beta_activity_days.source = 'direct' then excluded.source
          else public.beta_activity_days.source
        end;

  if v_uid is not null and char_length(v_token) between 8 and 200 then
    perform public.claim_user_acquisition(v_token);
  end if;

  return true;
end
$$;

revoke all on function public.record_beta_visit(text, text, text) from public;
grant execute on function public.record_beta_visit(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reader journey ledger independent of NOVELIGHT discovery impressions.
-- This preserves direct/X entry behavior that cannot be attributed to a recent
-- internal impression. It deliberately stores only pseudonymous identifiers.
-- ---------------------------------------------------------------------------
create table public.reader_journey_events (
  id uuid primary key default gen_random_uuid(),
  viewer_key_hash text not null,
  user_id uuid,
  event_type text not null check (
    event_type in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed')
  ),
  novel_id_snapshot text not null,
  episode_id_snapshot text,
  source text not null default 'direct',
  occurred_at timestamptz not null default now(),
  event_hour timestamptz not null,
  constraint reader_journey_hash_length check (char_length(viewer_key_hash) = 32)
);

create unique index reader_journey_hourly_dedupe_idx
  on public.reader_journey_events (
    viewer_key_hash,
    event_type,
    novel_id_snapshot,
    coalesce(episode_id_snapshot, ''),
    event_hour
  );
create index reader_journey_user_recent_idx
  on public.reader_journey_events (user_id, occurred_at desc)
  where user_id is not null;
create index reader_journey_novel_recent_idx
  on public.reader_journey_events (novel_id_snapshot, occurred_at desc);

alter table public.reader_journey_events enable row level security;
revoke all on table public.reader_journey_events from public, anon, authenticated;

create or replace function public.record_reader_journey_event(
  p_event_type text,
  p_novel_id text,
  p_episode_id text default null,
  p_visitor_token text default null,
  p_source text default 'direct'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_author_id uuid;
  v_source text := lower(coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'direct'));
  v_inserted integer := 0;
begin
  if p_event_type not in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed') then
    raise exception using errcode = '22023', message = 'Unsupported journey event';
  end if;

  if char_length(v_source) > 40 then
    raise exception using errcode = '22023', message = 'Traffic source is too long';
  end if;

  select n.user_id into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';
  if not found then return false; end if;

  if v_uid is not null and v_uid = v_author_id then
    return false;
  end if;

  if p_event_type = 'episode_read_10s' then
    if p_episode_id is null or not exists (
      select 1 from public.episodes e
       where e.id::text = p_episode_id
         and e.novel_id::text = p_novel_id
         and e.status = 'published'
    ) then
      raise exception using errcode = '23514', message = 'Published episode is required';
    end if;
  elsif p_episode_id is not null then
    raise exception using errcode = '22023', message = 'This event must not include an episode';
  end if;

  if p_event_type = 'favorite_added' then
    if v_uid is null or not exists (
      select 1 from public.favorites f
       where f.user_id = v_uid and f.novel_id::text = p_novel_id
    ) then return false; end if;
  end if;

  if p_event_type = 'light_seed' then
    if v_uid is null or not exists (
      select 1 from public.light_seeds s
       where s.reader_id = v_uid and s.novel_id_snapshot = p_novel_id
    ) then return false; end if;
  end if;

  if v_uid is not null then
    v_hash := md5('user:' || v_uid::text);
  else
    if char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := md5('visitor:' || v_token);
  end if;

  insert into public.reader_journey_events (
    viewer_key_hash,
    user_id,
    event_type,
    novel_id_snapshot,
    episode_id_snapshot,
    source,
    occurred_at,
    event_hour
  ) values (
    v_hash,
    v_uid,
    p_event_type,
    p_novel_id,
    p_episode_id,
    v_source,
    now(),
    date_trunc('hour', now())
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end
$$;

revoke all on function public.record_reader_journey_event(text, text, text, text, text) from public;
grant execute on function public.record_reader_journey_event(text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Founding Authors: first 100 distinct authors who publish a work after this
-- beta-foundation migration is deployed. Assignment is concurrency-safe and
-- immutable. Existing pre-migration/dev works are intentionally not backfilled.
-- ---------------------------------------------------------------------------
create table public.founding_authors (
  author_id uuid primary key,
  founding_number integer not null unique check (founding_number between 1 and 100),
  qualifying_novel_id text not null,
  qualified_at timestamptz not null default now()
);

alter table public.founding_authors enable row level security;
revoke all on table public.founding_authors from public, anon, authenticated;
grant select on table public.founding_authors to anon, authenticated;

create policy founding_authors_public_read
on public.founding_authors
for select
to anon, authenticated
using (true);

create or replace function public.assign_founding_author()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next integer;
begin
  if new.status <> 'published' then
    return new;
  end if;

  if exists (select 1 from public.founding_authors f where f.author_id = new.user_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('novelight:founding-authors'));

  if exists (select 1 from public.founding_authors f where f.author_id = new.user_id) then
    return new;
  end if;

  select coalesce(max(f.founding_number), 0) + 1
    into v_next
    from public.founding_authors f;

  if v_next <= 100 then
    insert into public.founding_authors (
      author_id,
      founding_number,
      qualifying_novel_id,
      qualified_at
    ) values (
      new.user_id,
      v_next,
      new.id::text,
      now()
    )
    on conflict (author_id) do nothing;
  end if;

  return new;
end
$$;

create trigger novels_assign_founding_author
  after insert or update of status
  on public.novels
  for each row
  when (new.status = 'published')
  execute function public.assign_founding_author();

-- ---------------------------------------------------------------------------
-- Stripe lifecycle audit ledger. Vercel webhook code writes here using the
-- service role after signature verification and entitlement synchronization.
-- ---------------------------------------------------------------------------
create table public.subscription_event_log (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_snapshot text not null check (plan_snapshot in ('free', 'standard', 'premium')),
  subscription_status text,
  payment_status text,
  event_created_at timestamptz,
  recorded_at timestamptz not null default now()
);

create index subscription_event_user_recent_idx
  on public.subscription_event_log (user_id, recorded_at desc)
  where user_id is not null;

alter table public.subscription_event_log enable row level security;
revoke all on table public.subscription_event_log from public, anon, authenticated;

commit;
