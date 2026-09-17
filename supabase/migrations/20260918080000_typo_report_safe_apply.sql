-- Competitor audit #7: reader typo suggestions with explicit author review and safe apply.
-- Typo reports are private workflow data. They never affect Rank, LIGHT SEED,
-- SCOUT, PV, favorites, exposure, or any other evaluation signal.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918080000-typo-report-safe-apply'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null then
    raise exception 'Required novels/episodes/episode_revisions tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episode_revisions'::regclass) then
    raise exception 'RLS must remain enabled on novels, episodes, and episode_revisions';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_interaction_settings') is not null
     or to_regclass('public.episode_typo_reports') is not null then
    raise exception 'Typo-report foundation tables already exist; stop and inspect before applying';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.episodes'::regclass
       and tgname = 'episode_revision_history_before_update'
       and not tgisinternal
  ) then
    raise exception 'Episode revision history trigger is required before typo safe-apply';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episode_revisions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%typo_apply%'
  ) then
    raise exception 'episode_revisions.change_kind must already support typo_apply';
  end if;
end
$$;

create table public.author_interaction_defaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  typo_reports_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.novel_interaction_settings (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  typo_reports_enabled boolean,
  updated_at timestamptz not null default now()
);

create table public.episode_typo_reports (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  start_char integer not null check (start_char > 0),
  original_text text not null
    check (char_length(original_text) between 1 and 200),
  replacement_text text not null
    check (char_length(replacement_text) <= 200),
  base_content_hash text not null
    check (base_content_hash ~ '^[0-9a-f]{32}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint episode_typo_reports_distinct_text
    check (original_text <> replacement_text),
  constraint episode_typo_reports_resolution_state
    check (
      (status = 'pending' and resolved_at is null)
      or (status <> 'pending' and resolved_at is not null)
    )
);

create index episode_typo_reports_author_status_created_idx
  on public.episode_typo_reports (author_id, status, created_at desc);

create index episode_typo_reports_reporter_created_idx
  on public.episode_typo_reports (reporter_id, created_at desc);

create index episode_typo_reports_episode_status_created_idx
  on public.episode_typo_reports (episode_id, status, created_at desc);

create unique index episode_typo_reports_pending_duplicate_idx
  on public.episode_typo_reports (
    episode_id,
    base_content_hash,
    start_char,
    original_text,
    replacement_text
  )
  where status = 'pending';

alter table public.author_interaction_defaults enable row level security;
alter table public.novel_interaction_settings enable row level security;
alter table public.episode_typo_reports enable row level security;

revoke all on table public.author_interaction_defaults from public, anon, authenticated;
revoke all on table public.novel_interaction_settings from public, anon, authenticated;
revoke all on table public.episode_typo_reports from public, anon, authenticated;

grant select, insert, update, delete on table public.author_interaction_defaults to service_role;
grant select, insert, update, delete on table public.novel_interaction_settings to service_role;
grant select, insert, update, delete on table public.episode_typo_reports to service_role;

create function public.novelight_author_typo_report_defaults()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select d.typo_reports_enabled
    into v_enabled
    from public.author_interaction_defaults d
   where d.user_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'typo_reports_enabled',
    coalesce(v_enabled, false)
  );
end
$$;

create function public.novelight_set_author_typo_report_defaults(
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
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Typo report default must be true or false' using errcode = '22023';
  end if;

  insert into public.author_interaction_defaults (
    user_id,
    typo_reports_enabled,
    updated_at
  ) values (
    v_uid,
    p_enabled,
    pg_catalog.now()
  )
  on conflict (user_id) do update
    set typo_reports_enabled = excluded.typo_reports_enabled,
        updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('typo_reports_enabled', p_enabled);
end
$$;

create function public.novelight_author_novel_typo_report_settings(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_default boolean := false;
  v_override boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  select coalesce(d.typo_reports_enabled, false)
    into v_default
    from public.author_interaction_defaults d
   where d.user_id = v_uid;

  if not found then
    v_default := false;
  end if;

  select s.typo_reports_enabled
    into v_override
    from public.novel_interaction_settings s
   where s.novel_id = p_novel_id;

  return pg_catalog.jsonb_build_object(
    'typo_reports_default', v_default,
    'typo_reports_override', v_override,
    'typo_reports_effective', coalesce(v_override, v_default, false)
  );
end
$$;

create function public.novelight_set_novel_typo_report_settings(
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
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  insert into public.novel_interaction_settings (
    novel_id,
    typo_reports_enabled,
    updated_at
  ) values (
    p_novel_id,
    p_enabled,
    pg_catalog.now()
  )
  on conflict (novel_id) do update
    set typo_reports_enabled = excluded.typo_reports_enabled,
        updated_at = pg_catalog.now();

  return public.novelight_author_novel_typo_report_settings(p_novel_id);
end
$$;

create function public.novelight_typo_report_state(
  p_episode_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := false;
begin
  select coalesce(s.typo_reports_enabled, d.typo_reports_enabled, false)
    into v_enabled
    from public.episodes e
    join public.novels n on n.id = e.novel_id
    left join public.novel_interaction_settings s on s.novel_id = n.id
    left join public.author_interaction_defaults d on d.user_id = n.user_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  return pg_catalog.jsonb_build_object('enabled', coalesce(v_enabled, false));
end
$$;

create function public.novelight_submit_typo_report(
  p_episode_id bigint,
  p_start_char integer,
  p_original_text text,
  p_replacement_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_novel_id bigint;
  v_author_id uuid;
  v_content text;
  v_episode_status text;
  v_novel_status text;
  v_enabled boolean := false;
  v_original text := coalesce(p_original_text, '');
  v_replacement text := coalesce(p_replacement_text, '');
  v_hash text;
  v_report_id uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_episode_id is null or p_start_char is null or p_start_char < 1 then
    raise exception 'Episode and selected position are required' using errcode = '22023';
  end if;
  if char_length(v_original) < 1 or char_length(v_original) > 200 then
    raise exception 'Selected text must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if char_length(v_replacement) > 200 then
    raise exception 'Replacement text must contain at most 200 characters' using errcode = '22023';
  end if;
  if v_original = v_replacement then
    raise exception 'Replacement must differ from selected text' using errcode = '22023';
  end if;

  select e.novel_id,
         e.user_id,
         e.content,
         e.status,
         n.status
    into v_novel_id,
         v_author_id,
         v_content,
         v_episode_status,
         v_novel_status
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id;

  if not found
     or v_episode_status <> 'published'
     or v_novel_status <> 'published' then
    raise exception 'Published episode not found' using errcode = '42501';
  end if;

  if v_author_id = v_uid then
    raise exception 'Authors cannot submit typo reports to their own episode' using errcode = '42501';
  end if;

  select coalesce(s.typo_reports_enabled, d.typo_reports_enabled, false)
    into v_enabled
    from public.novels n
    left join public.novel_interaction_settings s on s.novel_id = n.id
    left join public.author_interaction_defaults d on d.user_id = n.user_id
   where n.id = v_novel_id;

  if not coalesce(v_enabled, false) then
    raise exception 'TYPO_REPORTS_DISABLED' using errcode = '23514';
  end if;

  if p_start_char + char_length(v_original) - 1 > char_length(v_content)
     or substring(v_content from p_start_char for char_length(v_original)) <> v_original then
    raise exception 'Selected text no longer matches the current episode' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_count
    from public.episode_typo_reports r
   where r.reporter_id = v_uid
     and r.created_at >= pg_catalog.now() - interval '1 day';

  if v_count >= 12 then
    raise exception 'Daily typo report limit reached' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_count
    from public.episode_typo_reports r
   where r.reporter_id = v_uid
     and r.episode_id = p_episode_id
     and r.created_at >= pg_catalog.now() - interval '1 hour';

  if v_count >= 4 then
    raise exception 'Episode typo report rate limit reached' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_count
    from public.episode_typo_reports r
   where r.author_id = v_author_id
     and r.status = 'pending';

  if v_count >= 200 then
    raise exception 'Author typo report inbox is full' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_count
    from public.episode_typo_reports r
   where r.episode_id = p_episode_id
     and r.status = 'pending';

  if v_count >= 30 then
    raise exception 'Episode typo report inbox is full' using errcode = 'P0001';
  end if;

  v_hash := md5(v_content);

  if exists (
    select 1
      from public.episode_typo_reports r
     where r.episode_id = p_episode_id
       and r.base_content_hash = v_hash
       and r.start_char = p_start_char
       and r.original_text = v_original
       and r.replacement_text = v_replacement
       and r.status = 'pending'
  ) then
    return pg_catalog.jsonb_build_object(
      'submitted', false,
      'status', 'duplicate'
    );
  end if;

  insert into public.episode_typo_reports (
    episode_id,
    novel_id,
    author_id,
    reporter_id,
    start_char,
    original_text,
    replacement_text,
    base_content_hash
  ) values (
    p_episode_id,
    v_novel_id,
    v_author_id,
    v_uid,
    p_start_char,
    v_original,
    v_replacement,
    v_hash
  )
  returning id into v_report_id;

  return pg_catalog.jsonb_build_object(
    'submitted', true,
    'status', 'pending',
    'report_id', v_report_id
  );
end
$$;

create function public.novelight_list_author_typo_reports(
  p_novel_id bigint default null
)
returns table (
  report_id uuid,
  novel_id bigint,
  novel_title text,
  episode_id bigint,
  episode_number integer,
  episode_title text,
  original_text text,
  replacement_text text,
  start_char integer,
  status text,
  created_at timestamptz,
  resolved_at timestamptz,
  is_stale boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_novel_id is not null
     and not exists (
       select 1
         from public.novels n
        where n.id = p_novel_id
          and n.user_id = v_uid
     ) then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.novel_id,
         n.title,
         r.episode_id,
         e.episode_number,
         e.title,
         r.original_text,
         r.replacement_text,
         r.start_char,
         r.status,
         r.created_at,
         r.resolved_at,
         (
           r.status = 'pending'
           and (
             md5(e.content) <> r.base_content_hash
             or r.start_char + char_length(r.original_text) - 1 > char_length(e.content)
             or substring(e.content from r.start_char for char_length(r.original_text)) <> r.original_text
           )
         ) as is_stale
    from public.episode_typo_reports r
    join public.episodes e
      on e.id = r.episode_id
     and e.novel_id = r.novel_id
    join public.novels n
      on n.id = r.novel_id
     and n.user_id = v_uid
   where r.author_id = v_uid
     and (p_novel_id is null or r.novel_id = p_novel_id)
   order by (r.status = 'pending') desc, r.created_at desc, r.id desc
   limit 100;
end
$$;

create function public.novelight_resolve_typo_report(
  p_report_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.episode_typo_reports%rowtype;
  v_content text;
  v_episode_status text;
  v_new_content text;
  v_action text := lower(trim(coalesce(p_action, '')));
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_report_id is null then
    raise exception 'Typo report is required' using errcode = '22023';
  end if;
  if v_action not in ('accept', 'reject') then
    raise exception 'Action must be accept or reject' using errcode = '22023';
  end if;

  select r.*
    into v_report
    from public.episode_typo_reports r
   where r.id = p_report_id
     and r.author_id = v_uid
   for update;

  if not found then
    raise exception 'Typo report not found or not owned by current user' using errcode = '42501';
  end if;

  if v_report.status <> 'pending' then
    return pg_catalog.jsonb_build_object(
      'status', v_report.status,
      'applied', false
    );
  end if;

  if v_action = 'reject' then
    update public.episode_typo_reports
       set status = 'rejected',
           resolved_at = pg_catalog.now()
     where id = v_report.id;

    return pg_catalog.jsonb_build_object(
      'status', 'rejected',
      'applied', false
    );
  end if;

  select e.content,
         e.status
    into v_content,
         v_episode_status
    from public.episodes e
   where e.id = v_report.episode_id
     and e.novel_id = v_report.novel_id
     and e.user_id = v_uid
   for update;

  if not found
     or md5(v_content) <> v_report.base_content_hash
     or v_report.start_char + char_length(v_report.original_text) - 1 > char_length(v_content)
     or substring(
          v_content
          from v_report.start_char
          for char_length(v_report.original_text)
        ) <> v_report.original_text then
    update public.episode_typo_reports
       set status = 'stale',
           resolved_at = pg_catalog.now()
     where id = v_report.id;

    return pg_catalog.jsonb_build_object(
      'status', 'stale',
      'applied', false
    );
  end if;

  v_new_content := overlay(
    v_content
    placing v_report.replacement_text
    from v_report.start_char
    for char_length(v_report.original_text)
  );

  if v_episode_status = 'published'
     and char_length(btrim(v_new_content)) < 1 then
    raise exception 'Published episode content cannot become empty' using errcode = '22023';
  end if;

  perform set_config('novelight.revision_reason', 'typo_apply', true);

  update public.episodes e
     set content = v_new_content
   where e.id = v_report.episode_id
     and e.novel_id = v_report.novel_id
     and e.user_id = v_uid;

  update public.episode_typo_reports
     set status = 'accepted',
         resolved_at = pg_catalog.now()
   where id = v_report.id;

  return pg_catalog.jsonb_build_object(
    'status', 'accepted',
    'applied', true
  );
end
$$;

revoke all on function public.novelight_author_typo_report_defaults() from public, anon, authenticated;
revoke all on function public.novelight_set_author_typo_report_defaults(boolean) from public, anon, authenticated;
revoke all on function public.novelight_author_novel_typo_report_settings(bigint) from public, anon, authenticated;
revoke all on function public.novelight_set_novel_typo_report_settings(bigint, boolean) from public, anon, authenticated;
revoke all on function public.novelight_typo_report_state(bigint) from public, anon, authenticated;
revoke all on function public.novelight_submit_typo_report(bigint, integer, text, text) from public, anon, authenticated;
revoke all on function public.novelight_list_author_typo_reports(bigint) from public, anon, authenticated;
revoke all on function public.novelight_resolve_typo_report(uuid, text) from public, anon, authenticated;

grant execute on function public.novelight_author_typo_report_defaults() to authenticated, service_role;
grant execute on function public.novelight_set_author_typo_report_defaults(boolean) to authenticated, service_role;
grant execute on function public.novelight_author_novel_typo_report_settings(bigint) to authenticated, service_role;
grant execute on function public.novelight_set_novel_typo_report_settings(bigint, boolean) to authenticated, service_role;
grant execute on function public.novelight_typo_report_state(bigint) to anon, authenticated, service_role;
grant execute on function public.novelight_submit_typo_report(bigint, integer, text, text) to authenticated, service_role;
grant execute on function public.novelight_list_author_typo_reports(bigint) to authenticated, service_role;
grant execute on function public.novelight_resolve_typo_report(uuid, text) to authenticated, service_role;

comment on table public.episode_typo_reports is
  'Private reader typo suggestions. Authors review explicitly; no report auto-applies.';
comment on function public.novelight_resolve_typo_report(uuid, text) is
  'Owner-only typo review. Accept revalidates the exact source snapshot and records the prior prose through episode revision history before changing content.';

commit;
