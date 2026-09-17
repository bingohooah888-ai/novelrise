-- Competitor audit #8: bounded private episode revision history and safe rollback.
-- This migration is intentionally NOT applied to Production by this PR.

create table if not exists public.episode_revisions (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  episode_number integer not null,
  title text not null,
  content text not null,
  change_kind text not null default 'edit'
    check (change_kind in ('edit', 'restore', 'typo_apply')),
  created_at timestamptz not null default now()
);

create index if not exists episode_revisions_episode_created_idx
  on public.episode_revisions (episode_id, created_at desc, id desc);

alter table public.episode_revisions enable row level security;

-- Revision bodies are private implementation data. Clients only use the
-- owner-checking RPCs below; readers never receive direct table access.
revoke all on table public.episode_revisions from public;
revoke all on table public.episode_revisions from anon;
revoke all on table public.episode_revisions from authenticated;

create or replace function public.novelight_capture_episode_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reason text;
begin
  if old.title is not distinct from new.title
     and old.content is not distinct from new.content then
    return new;
  end if;

  v_reason := coalesce(nullif(current_setting('novelight.revision_reason', true), ''), 'edit');
  if v_reason not in ('edit', 'restore', 'typo_apply') then
    v_reason := 'edit';
  end if;

  -- Access retention is 90 days, and storage is capped to the latest 20
  -- snapshots per episode. Dormant episodes can retain at most 20 rows.
  delete from public.episode_revisions
   where episode_id = old.id
     and created_at < now() - interval '90 days';

  insert into public.episode_revisions (
    episode_id,
    novel_id,
    user_id,
    episode_number,
    title,
    content,
    change_kind
  ) values (
    old.id,
    old.novel_id,
    old.user_id,
    old.episode_number,
    old.title,
    old.content,
    v_reason
  );

  delete from public.episode_revisions r
   where r.episode_id = old.id
     and r.id in (
       select doomed.id
         from public.episode_revisions doomed
        where doomed.episode_id = old.id
        order by doomed.created_at desc, doomed.id desc
        offset 20
     );

  return new;
end;
$$;

revoke all on function public.novelight_capture_episode_revision() from public;
revoke all on function public.novelight_capture_episode_revision() from anon;
revoke all on function public.novelight_capture_episode_revision() from authenticated;

create or replace trigger episode_revision_history_before_update
before update of title, content on public.episodes
for each row
execute function public.novelight_capture_episode_revision();

create or replace function public.novelight_list_episode_revisions(p_episode_id bigint)
returns table (
  revision_id uuid,
  created_at timestamptz,
  change_kind text,
  episode_number integer,
  title text,
  content_chars integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.episodes e
     where e.id = p_episode_id
       and e.user_id = v_uid
  ) then
    raise exception 'episode not found or not owned' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.created_at,
         r.change_kind,
         r.episode_number,
         r.title,
         char_length(r.content)::integer
    from public.episode_revisions r
   where r.episode_id = p_episode_id
     and r.user_id = v_uid
     and r.created_at >= now() - interval '90 days'
   order by r.created_at desc, r.id desc
   limit 20;
end;
$$;

create or replace function public.novelight_get_episode_revision(p_revision_id uuid)
returns table (
  revision_id uuid,
  episode_id bigint,
  created_at timestamptz,
  change_kind text,
  episode_number integer,
  title text,
  content text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.episode_id,
         r.created_at,
         r.change_kind,
         r.episode_number,
         r.title,
         r.content
    from public.episode_revisions r
    join public.episodes e
      on e.id = r.episode_id
     and e.user_id = v_uid
   where r.id = p_revision_id
     and r.user_id = v_uid
     and r.created_at >= now() - interval '90 days'
   limit 1;
end;
$$;

create or replace function public.novelight_restore_episode_revision(
  p_episode_id bigint,
  p_revision_id uuid
)
returns table (
  episode_id bigint,
  title text,
  content text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_episode public.episodes%rowtype;
  v_revision public.episode_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select e.*
    into v_episode
    from public.episodes e
   where e.id = p_episode_id
     and e.user_id = v_uid
   for update;

  if not found then
    raise exception 'episode not found or not owned' using errcode = '42501';
  end if;

  select r.*
    into v_revision
    from public.episode_revisions r
   where r.id = p_revision_id
     and r.episode_id = p_episode_id
     and r.user_id = v_uid
     and r.created_at >= now() - interval '90 days';

  if not found then
    raise exception 'revision not found or expired' using errcode = '22023';
  end if;

  if char_length(v_revision.title) > 150 then
    raise exception 'revision title is invalid' using errcode = '22023';
  end if;
  if char_length(v_revision.content) > 100000 then
    raise exception 'revision content is invalid' using errcode = '22023';
  end if;
  if v_episode.status = 'published'
     and (char_length(btrim(v_revision.title)) < 1 or char_length(btrim(v_revision.content)) < 1) then
    raise exception 'published episode cannot restore empty title or content' using errcode = '22023';
  end if;

  perform set_config('novelight.revision_reason', 'restore', true);

  -- Deliberately restore ONLY prose fields on the existing episode row.
  -- episode id/number, publication state/schedule, PV, Rank, LIGHT SEED,
  -- SCOUT and every other evaluation datum remain current.
  update public.episodes e
     set title = v_revision.title,
         content = v_revision.content
   where e.id = p_episode_id
     and e.user_id = v_uid;

  return query
  select e.id, e.title, e.content
    from public.episodes e
   where e.id = p_episode_id;
end;
$$;

revoke all on function public.novelight_list_episode_revisions(bigint) from public;
revoke all on function public.novelight_get_episode_revision(uuid) from public;
revoke all on function public.novelight_restore_episode_revision(bigint, uuid) from public;
revoke all on function public.novelight_list_episode_revisions(bigint) from anon;
revoke all on function public.novelight_get_episode_revision(uuid) from anon;
revoke all on function public.novelight_restore_episode_revision(bigint, uuid) from anon;
grant execute on function public.novelight_list_episode_revisions(bigint) to authenticated;
grant execute on function public.novelight_get_episode_revision(uuid) to authenticated;
grant execute on function public.novelight_restore_episode_revision(bigint, uuid) to authenticated;
