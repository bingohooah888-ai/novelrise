-- NOVELIGHT competitor audit B #7: reader typo suggestion -> author review -> safe apply.
--
-- This workflow is direct author-reader assistance only. It never changes Rank,
-- LIGHT SEED, SCOUT, PV, favorites, exposure allocation, or other evaluation data.
-- Suggestions are never auto-applied. Only the current work owner can apply them,
-- and an apply is allowed only while the originally reported source text still
-- exists at the exact stored offset. Applied prose changes are captured by the
-- existing episode revision history as change_kind = 'typo_apply'.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918112000-typo-report-review'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'Typo report prerequisites are missing';
  end if;

  if to_regclass('public.novel_typo_report_settings') is not null
     or to_regclass('public.episode_typo_reports') is not null then
    raise exception 'Typo report runtime is already installed';
  end if;

  if to_regprocedure('public.novelight_typo_report_state(bigint)') is not null
     or to_regprocedure('public.novelight_author_typo_report_settings(bigint)') is not null
     or to_regprocedure('public.novelight_set_novel_typo_reports_enabled(bigint,boolean)') is not null
     or to_regprocedure('public.novelight_submit_typo_report(bigint,text,text)') is not null
     or to_regprocedure('public.novelight_author_typo_reports(bigint,text)') is not null
     or to_regprocedure('public.novelight_apply_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_reject_typo_report(uuid)') is not null then
    raise exception 'Typo report RPCs already exist';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'episodes'
       and t.tgname = 'episode_revision_history_before_update'
       and not t.tgisinternal
  ) then
    raise exception 'Episode revision history trigger is required';
  end if;
end
$$;

create table public.novel_typo_report_settings (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.episode_typo_reports (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  source_start integer not null,
  source_text text not null,
  replacement_text text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint episode_typo_reports_source_start_check check (source_start >= 0),
  constraint episode_typo_reports_source_length_check check (
    char_length(source_text) between 1 and 300
  ),
  constraint episode_typo_reports_replacement_length_check check (
    char_length(replacement_text) <= 300
  ),
  constraint episode_typo_reports_changed_check check (
    source_text is distinct from replacement_text
  ),
  constraint episode_typo_reports_status_check check (
    status in ('pending', 'applied', 'rejected', 'stale')
  )
);

create unique index episode_typo_reports_pending_duplicate_idx
  on public.episode_typo_reports (
    episode_id,
    source_start,
    source_text,
    replacement_text
  )
  where status = 'pending';

create index episode_typo_reports_author_novel_status_created_idx
  on public.episode_typo_reports (author_id, novel_id, status, created_at desc);

create index episode_typo_reports_reporter_created_idx
  on public.episode_typo_reports (reporter_id, created_at desc);

alter table public.novel_typo_report_settings enable row level security;
alter table public.episode_typo_reports enable row level security;

revoke all on table public.novel_typo_report_settings from public, anon, authenticated;
revoke all on table public.episode_typo_reports from public, anon, authenticated;

create function public.novelight_typo_report_state(p_episode_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author_id uuid;
  v_enabled boolean := false;
begin
  if p_episode_id is null then
    return pg_catalog.jsonb_build_object('enabled', false);
  end if;

  select n.user_id,
         coalesce(s.enabled, false)
    into v_author_id, v_enabled
    from public.episodes e
    join public.novels n on n.id = e.novel_id
    left join public.novel_typo_report_settings s on s.novel_id = n.id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object('enabled', false);
  end if;

  if v_uid is not null then
    if v_uid = v_author_id then
      v_enabled := false;
    elsif exists (
      select 1
        from public.user_blocks b
       where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
          or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
    ) then
      v_enabled := false;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('enabled', v_enabled);
end
$$;

create function public.novelight_author_typo_report_settings(p_novel_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean := false;
  v_pending integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  select coalesce(s.enabled, false)
    into v_enabled
    from public.novel_typo_report_settings s
   where s.novel_id = p_novel_id;

  if not found then
    v_enabled := false;
  end if;

  select count(*)::integer
    into v_pending
    from public.episode_typo_reports r
   where r.novel_id = p_novel_id
     and r.author_id = v_uid
     and r.status = 'pending';

  return pg_catalog.jsonb_build_object(
    'enabled', v_enabled,
    'pending_count', v_pending
  );
end
$$;

create function public.novelight_set_novel_typo_reports_enabled(
  p_novel_id bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'Enabled state is required';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  insert into public.novel_typo_report_settings (novel_id, enabled, updated_at)
  values (p_novel_id, p_enabled, pg_catalog.now())
  on conflict (novel_id) do update
    set enabled = excluded.enabled,
        updated_at = pg_catalog.now();

  return public.novelight_author_typo_report_settings(p_novel_id);
end
$$;

create function public.novelight_submit_typo_report(
  p_episode_id bigint,
  p_source_text text,
  p_replacement_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := coalesce(p_source_text, '');
  v_replacement text := coalesce(p_replacement_text, '');
  v_novel_id bigint;
  v_author_id uuid;
  v_content text;
  v_first integer;
  v_occurrences integer;
  v_report_id uuid;
  v_existing_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_episode_id is null then
    raise exception using errcode = '22023', message = 'Episode is required';
  end if;
  if char_length(v_source) < 1
     or char_length(v_source) > 300
     or char_length(pg_catalog.btrim(v_source)) < 1 then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_SOURCE_LENGTH';
  end if;
  if char_length(v_replacement) > 300 then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_REPLACEMENT_LENGTH';
  end if;
  if v_source = v_replacement then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_NO_CHANGE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:typo:episode:' || p_episode_id::text, 0)
  );

  select e.novel_id, n.user_id, e.content
    into v_novel_id, v_author_id, v_content
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published'
   for share of e, n;

  if not found then
    raise exception using errcode = '42501', message = 'Published episode not found';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = 'Authors cannot report their own episode';
  end if;

  if not exists (
    select 1
      from public.novel_typo_report_settings s
     where s.novel_id = v_novel_id
       and s.enabled = true
  ) then
    raise exception using errcode = '42501', message = 'TYPO_REPORTS_DISABLED';
  end if;

  if exists (
    select 1
      from public.user_blocks b
     where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
        or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
  ) then
    raise exception using errcode = '42501', message = 'DIRECT_INTERACTION_UNAVAILABLE';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.reporter_id = v_uid
       and r.created_at >= pg_catalog.now() - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = '42900', message = 'TYPO_REPORT_RATE_LIMIT';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.reporter_id = v_uid
       and r.created_at >= pg_catalog.now() - interval '1 day'
  ) >= 50 then
    raise exception using errcode = '42900', message = 'TYPO_REPORT_RATE_LIMIT';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.episode_id = p_episode_id
       and r.status = 'pending'
  ) >= 50 then
    raise exception using errcode = '54000', message = 'TYPO_REPORT_EPISODE_LIMIT';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.novel_id = v_novel_id
       and r.status = 'pending'
  ) >= 300 then
    raise exception using errcode = '54000', message = 'TYPO_REPORT_NOVEL_LIMIT';
  end if;

  -- Count every matching start position, including overlapping matches
  -- (for example source "aa" inside content "aaa"). A report is accepted only
  -- when the submitted source identifies exactly one current location.
  select min(pos)::integer,
         count(*)::integer
    into v_first, v_occurrences
    from pg_catalog.generate_series(
           1,
           greatest(
             pg_catalog.char_length(v_content) - pg_catalog.char_length(v_source) + 1,
             0
           )
         ) as positions(pos)
   where pg_catalog.substr(
           v_content,
           pos,
           pg_catalog.char_length(v_source)
         ) = v_source;

  if v_occurrences = 0 then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_SOURCE_NOT_FOUND';
  end if;

  if v_occurrences > 1 then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_SOURCE_NOT_UNIQUE';
  end if;

  select r.id
    into v_existing_id
    from public.episode_typo_reports r
   where r.episode_id = p_episode_id
     and r.source_start = v_first - 1
     and r.source_text = v_source
     and r.replacement_text = v_replacement
     and r.status = 'pending'
   limit 1;

  if found then
    raise exception using errcode = '23505', message = 'TYPO_REPORT_DUPLICATE';
  end if;

  insert into public.episode_typo_reports (
    episode_id,
    novel_id,
    author_id,
    reporter_id,
    source_start,
    source_text,
    replacement_text
  ) values (
    p_episode_id,
    v_novel_id,
    v_author_id,
    v_uid,
    v_first - 1,
    v_source,
    v_replacement
  )
  returning id into v_report_id;

  return v_report_id;
end
$$;

create function public.novelight_author_typo_reports(
  p_novel_id bigint,
  p_status text default 'pending'
)
returns table (
  report_id uuid,
  episode_id bigint,
  episode_number bigint,
  episode_title text,
  source_start integer,
  source_text text,
  replacement_text text,
  report_status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := coalesce(p_status, 'pending');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if v_status not in ('pending', 'applied', 'rejected', 'stale', 'all') then
    raise exception using errcode = '22023', message = 'Invalid typo report status';
  end if;

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  return query
  select r.id,
         r.episode_id,
         e.episode_number,
         e.title,
         r.source_start,
         r.source_text,
         r.replacement_text,
         r.status,
         r.created_at,
         r.resolved_at
    from public.episode_typo_reports r
    join public.episodes e on e.id = r.episode_id
   where r.novel_id = p_novel_id
     and r.author_id = v_uid
     and (v_status = 'all' or r.status = v_status)
   order by r.created_at desc, r.id desc
   limit 200;
end
$$;

create function public.novelight_apply_typo_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.episode_typo_reports%rowtype;
  v_episode public.episodes%rowtype;
  v_current_source text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_report_id is null then
    raise exception using errcode = '22023', message = 'Report is required';
  end if;

  select r.*
    into v_report
    from public.episode_typo_reports r
   where r.id = p_report_id
     and r.author_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Typo report not found or not owned';
  end if;
  if v_report.status <> 'pending' then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_NOT_PENDING';
  end if;

  select e.*
    into v_episode
    from public.episodes e
   where e.id = v_report.episode_id
     and e.novel_id = v_report.novel_id
     and e.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned episode not found';
  end if;

  v_current_source := pg_catalog.substr(
    v_episode.content,
    v_report.source_start + 1,
    char_length(v_report.source_text)
  );

  if v_current_source is distinct from v_report.source_text then
    update public.episode_typo_reports
       set status = 'stale',
           resolved_at = pg_catalog.now()
     where id = v_report.id;

    return pg_catalog.jsonb_build_object(
      'applied', false,
      'status', 'stale',
      'episode_id', v_report.episode_id
    );
  end if;

  perform pg_catalog.set_config('novelight.revision_reason', 'typo_apply', true);

  update public.episodes e
     set content =
       pg_catalog.substr(e.content, 1, v_report.source_start)
       || v_report.replacement_text
       || pg_catalog.substr(
            e.content,
            v_report.source_start + char_length(v_report.source_text) + 1
          )
   where e.id = v_report.episode_id
     and e.user_id = v_uid;

  update public.episode_typo_reports
     set status = 'applied',
         resolved_at = pg_catalog.now()
   where id = v_report.id;

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'status', 'applied',
    'episode_id', v_report.episode_id
  );
end
$$;

create function public.novelight_reject_typo_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_episode_id bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_report_id is null then
    raise exception using errcode = '22023', message = 'Report is required';
  end if;

  update public.episode_typo_reports r
     set status = 'rejected',
         resolved_at = pg_catalog.now()
   where r.id = p_report_id
     and r.author_id = v_uid
     and r.status = 'pending'
  returning r.episode_id into v_episode_id;

  if not found then
    raise exception using errcode = '22023', message = 'TYPO_REPORT_NOT_PENDING';
  end if;

  return pg_catalog.jsonb_build_object(
    'rejected', true,
    'status', 'rejected',
    'episode_id', v_episode_id
  );
end
$$;

revoke all on function public.novelight_typo_report_state(bigint) from public, anon, authenticated, service_role;
revoke all on function public.novelight_author_typo_report_settings(bigint) from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_novel_typo_reports_enabled(bigint, boolean) from public, anon, authenticated, service_role;
revoke all on function public.novelight_submit_typo_report(bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.novelight_author_typo_reports(bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.novelight_apply_typo_report(uuid) from public, anon, authenticated, service_role;
revoke all on function public.novelight_reject_typo_report(uuid) from public, anon, authenticated, service_role;

grant execute on function public.novelight_typo_report_state(bigint) to anon, authenticated, service_role;
grant execute on function public.novelight_author_typo_report_settings(bigint) to authenticated, service_role;
grant execute on function public.novelight_set_novel_typo_reports_enabled(bigint, boolean) to authenticated, service_role;
grant execute on function public.novelight_submit_typo_report(bigint, text, text) to authenticated, service_role;
grant execute on function public.novelight_author_typo_reports(bigint, text) to authenticated, service_role;
grant execute on function public.novelight_apply_typo_report(uuid) to authenticated, service_role;
grant execute on function public.novelight_reject_typo_report(uuid) to authenticated, service_role;

commit;
