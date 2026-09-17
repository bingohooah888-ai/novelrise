-- Competitor audit #7: reader typo proposals with author-reviewed safe apply.
-- No proposal is ever applied automatically. Readers submit a bounded text
-- replacement against an exact published episode snapshot; the author must
-- explicitly apply or reject it.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918080000-typo-report-workflow'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null then
    raise exception 'Required novels/episodes/revision-history tables are missing';
  end if;

  if to_regclass('public.episode_typo_reports') is not null then
    raise exception 'public.episode_typo_reports already exists; stop and inspect';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'typo_reports_enabled'
  ) then
    raise exception 'novels.typo_reports_enabled already exists; stop and inspect';
  end if;

  if to_regprocedure('public.novelight_submit_episode_typo_report(bigint,integer,text,text)') is not null
     or to_regprocedure('public.novelight_list_episode_typo_reports(bigint)') is not null
     or to_regprocedure('public.novelight_apply_episode_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_reject_episode_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_stale_episode_typo_reports()') is not null then
    raise exception 'One or more typo-report functions already exist; stop and inspect';
  end if;

  if to_regprocedure('public.novelight_capture_episode_revision()') is null then
    raise exception 'Episode revision trigger function is required before typo-report apply';
  end if;

  if position(
    '''typo_apply''' in pg_get_functiondef(
      'public.novelight_capture_episode_revision()'::regprocedure
    )
  ) = 0 then
    raise exception 'Revision history does not recognize typo_apply';
  end if;
end
$$;

alter table public.novels
  add column typo_reports_enabled boolean not null default true;

create table public.episode_typo_reports (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  source_start integer not null check (source_start >= 1),
  source_length integer not null check (source_length between 1 and 500),
  original_text text not null
    check (char_length(original_text) between 1 and 500),
  replacement_text text not null
    check (char_length(replacement_text) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (original_text <> replacement_text)
);

create index episode_typo_reports_author_pending_idx
  on public.episode_typo_reports (author_id, episode_id, created_at desc)
  where status = 'pending';

create index episode_typo_reports_reporter_recent_idx
  on public.episode_typo_reports (reporter_id, created_at desc);

create unique index episode_typo_reports_pending_duplicate_idx
  on public.episode_typo_reports (
    reporter_id,
    episode_id,
    source_start,
    source_length,
    md5(original_text),
    md5(replacement_text)
  )
  where status = 'pending';

alter table public.episode_typo_reports enable row level security;

revoke all on table public.episode_typo_reports from public, anon, authenticated;

create function public.novelight_submit_episode_typo_report(
  p_episode_id bigint,
  p_source_start integer,
  p_original_text text,
  p_replacement_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_episode public.episodes%rowtype;
  v_novel public.novels%rowtype;
  v_source_length integer;
  v_report_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_episode_id is null
     or p_source_start is null
     or p_source_start < 1 then
    raise exception 'Episode and source position are required' using errcode = '22023';
  end if;

  v_source_length := char_length(coalesce(p_original_text, ''));

  if v_source_length < 1 or v_source_length > 500 then
    raise exception 'Selected typo text must contain 1 to 500 characters' using errcode = '22023';
  end if;

  if char_length(coalesce(p_replacement_text, '')) > 500 then
    raise exception 'Replacement text must contain at most 500 characters' using errcode = '22023';
  end if;

  if p_original_text is not distinct from p_replacement_text then
    raise exception 'Replacement text must differ from the selected text' using errcode = '22023';
  end if;

  select e.*
    into v_episode
    from public.episodes e
   where e.id = p_episode_id
     and e.status = 'published';

  if not found then
    raise exception 'Published episode not found' using errcode = '42501';
  end if;

  select n.*
    into v_novel
    from public.novels n
   where n.id = v_episode.novel_id
     and n.status = 'published';

  if not found then
    raise exception 'Published novel not found' using errcode = '42501';
  end if;

  if v_episode.user_id = v_uid then
    raise exception 'Authors cannot submit typo reports to their own episode' using errcode = '42501';
  end if;

  if v_novel.typo_reports_enabled is not true then
    raise exception 'TYPO_REPORTS_DISABLED' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.user_blocks b
     where (b.blocker_user_id = v_episode.user_id and b.blocked_user_id = v_uid)
        or (b.blocker_user_id = v_uid and b.blocked_user_id = v_episode.user_id)
  ) then
    raise exception 'DIRECT_INTERACTION_UNAVAILABLE' using errcode = '42501';
  end if;

  if substring(v_episode.content from p_source_start for v_source_length)
     is distinct from p_original_text then
    raise exception 'TYPO_SOURCE_CHANGED' using errcode = '22023';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.reporter_id = v_uid
       and r.created_at >= now() - interval '24 hours'
  ) >= 20 then
    raise exception 'TYPO_REPORT_RATE_LIMIT' using errcode = '22023';
  end if;

  if (
    select count(*)
      from public.episode_typo_reports r
     where r.reporter_id = v_uid
       and r.episode_id = p_episode_id
       and r.status = 'pending'
  ) >= 5 then
    raise exception 'TYPO_REPORT_EPISODE_LIMIT' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.episode_typo_reports r
     where r.reporter_id = v_uid
       and r.episode_id = p_episode_id
       and r.source_start = p_source_start
       and r.source_length = v_source_length
       and r.original_text = p_original_text
       and r.replacement_text = p_replacement_text
       and r.status = 'pending'
  ) then
    raise exception 'TYPO_REPORT_DUPLICATE' using errcode = '23505';
  end if;

  insert into public.episode_typo_reports (
    episode_id,
    novel_id,
    author_id,
    reporter_id,
    source_start,
    source_length,
    original_text,
    replacement_text
  ) values (
    v_episode.id,
    v_episode.novel_id,
    v_episode.user_id,
    v_uid,
    p_source_start,
    v_source_length,
    p_original_text,
    coalesce(p_replacement_text, '')
  )
  returning id into v_report_id;

  return v_report_id;
end
$$;

create function public.novelight_list_episode_typo_reports(
  p_episode_id bigint
)
returns table (
  report_id uuid,
  created_at timestamptz,
  original_text text,
  replacement_text text,
  source_start integer,
  source_length integer,
  is_current boolean
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

  if not exists (
    select 1
      from public.episodes e
     where e.id = p_episode_id
       and e.user_id = v_uid
  ) then
    raise exception 'Episode not found or not owned by current user' using errcode = '42501';
  end if;

  update public.episode_typo_reports
     set status = 'stale',
         resolved_at = coalesce(resolved_at, now())
   where episode_id = p_episode_id
     and author_id = v_uid
     and status = 'pending'
     and created_at < now() - interval '30 days';

  return query
  select r.id,
         r.created_at,
         r.original_text,
         r.replacement_text,
         r.source_start,
         r.source_length,
         substring(e.content from r.source_start for r.source_length) = r.original_text
    from public.episode_typo_reports r
    join public.episodes e on e.id = r.episode_id
   where r.episode_id = p_episode_id
     and r.author_id = v_uid
     and r.status = 'pending'
   order by r.created_at asc, r.id asc
   limit 100;
end
$$;

create function public.novelight_apply_episode_typo_report(
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.episode_typo_reports%rowtype;
  v_episode public.episodes%rowtype;
  v_new_content text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select r.*
    into v_report
    from public.episode_typo_reports r
   where r.id = p_report_id
     and r.author_id = v_uid
   for update;

  if not found then
    raise exception 'Typo report not found or not owned by current author' using errcode = '42501';
  end if;

  if v_report.status <> 'pending' then
    return jsonb_build_object('status', v_report.status);
  end if;

  select e.*
    into v_episode
    from public.episodes e
   where e.id = v_report.episode_id
     and e.user_id = v_uid
   for update;

  if not found then
    raise exception 'Episode not found or not owned by current author' using errcode = '42501';
  end if;

  if substring(v_episode.content from v_report.source_start for v_report.source_length)
     is distinct from v_report.original_text then
    update public.episode_typo_reports
       set status = 'stale',
           resolved_at = now()
     where id = v_report.id;

    return jsonb_build_object('status', 'stale');
  end if;

  v_new_content := overlay(
    v_episode.content
    placing v_report.replacement_text
    from v_report.source_start
    for v_report.source_length
  );

  if v_episode.status = 'published' and char_length(btrim(v_new_content)) < 1 then
    raise exception 'Published episode cannot become empty' using errcode = '22023';
  end if;

  update public.episode_typo_reports
     set status = 'applied',
         resolved_at = now()
   where id = v_report.id;

  perform set_config('novelight.revision_reason', 'typo_apply', true);

  update public.episodes e
     set content = v_new_content
   where e.id = v_episode.id
     and e.user_id = v_uid;

  return jsonb_build_object(
    'status', 'applied',
    'episode_id', v_episode.id,
    'content', v_new_content
  );
end
$$;

create function public.novelight_reject_episode_typo_report(
  p_report_id uuid
)
returns boolean
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

  update public.episode_typo_reports r
     set status = 'rejected',
         resolved_at = now()
   where r.id = p_report_id
     and r.author_id = v_uid
     and r.status = 'pending';

  if not found then
    raise exception 'Pending typo report not found or not owned by current author' using errcode = '42501';
  end if;

  return true;
end
$$;

create function public.novelight_stale_episode_typo_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.content is not distinct from new.content then
    return new;
  end if;

  update public.episode_typo_reports
     set status = 'stale',
         resolved_at = coalesce(resolved_at, now())
   where episode_id = new.id
     and status = 'pending';

  return new;
end
$$;

create trigger episode_typo_reports_after_content_update
after update of content on public.episodes
for each row
execute function public.novelight_stale_episode_typo_reports();

revoke all on function public.novelight_submit_episode_typo_report(bigint, integer, text, text) from public, anon, authenticated;
revoke all on function public.novelight_list_episode_typo_reports(bigint) from public, anon, authenticated;
revoke all on function public.novelight_apply_episode_typo_report(uuid) from public, anon, authenticated;
revoke all on function public.novelight_reject_episode_typo_report(uuid) from public, anon, authenticated;
revoke all on function public.novelight_stale_episode_typo_reports() from public, anon, authenticated, service_role;

grant execute on function public.novelight_submit_episode_typo_report(bigint, integer, text, text) to authenticated, service_role;
grant execute on function public.novelight_list_episode_typo_reports(bigint) to authenticated, service_role;
grant execute on function public.novelight_apply_episode_typo_report(uuid) to authenticated, service_role;
grant execute on function public.novelight_reject_episode_typo_report(uuid) to authenticated, service_role;

commit;
