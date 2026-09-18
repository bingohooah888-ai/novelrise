-- NOVELIGHT competitor audit item #19: small author status/update notes.
-- Presentation-only author profile adjunct; never a social or discovery signal.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919090000'));

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.novels') is null then
    raise exception '#19 author notes require profiles and novels';
  end if;
  if to_regclass('public.author_notes') is not null
     or to_regprocedure('public.novelight_public_author_notes(uuid,integer)') is not null then
    raise exception '#19 author notes runtime already exists';
  end if;
end
$$;

create table public.author_notes (
  id bigint generated always as identity primary key,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  linked_novel_id bigint references public.novels(id) on delete set null,
  status text not null default 'published',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint author_notes_title_valid
    check (char_length(btrim(title)) between 1 and 80),
  constraint author_notes_body_valid
    check (char_length(btrim(body)) between 1 and 1000),
  constraint author_notes_status_valid
    check (status in ('published', 'archived')),
  constraint author_notes_archive_state_valid
    check (
      (status = 'published' and archived_at is null)
      or (status = 'archived' and archived_at is not null)
    )
);

create index author_notes_public_feed_idx
  on public.author_notes (author_user_id, published_at desc, id desc)
  where status = 'published';
create index author_notes_owner_management_idx
  on public.author_notes (author_user_id, updated_at desc, id desc);

alter table public.author_notes enable row level security;
revoke all on table public.author_notes from public, anon, authenticated, service_role;
revoke all on sequence public.author_notes_id_seq from public, anon, authenticated, service_role;

create or replace function public.novelight_public_author_notes(
  p_author_user_id uuid,
  p_limit integer default 5
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'title', q.title,
        'body', q.body,
        'published_at', q.published_at,
        'linked_novel', case
          when q.novel_id is null then null
          else pg_catalog.jsonb_build_object('id', q.novel_id, 'title', q.novel_title)
        end
      ) order by q.published_at desc, q.id desc
    ),
    '[]'::jsonb
  )
  from (
    select
      note.id,
      note.title,
      note.body,
      note.published_at,
      novel.id as novel_id,
      novel.title as novel_title
    from public.author_notes note
    left join public.novels novel
      on novel.id = note.linked_novel_id
     and novel.user_id = note.author_user_id
     and novel.status = 'published'
    where note.author_user_id = p_author_user_id
      and note.status = 'published'
    order by note.published_at desc, note.id desc
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) q
$$;

create or replace function public.novelight_manage_my_author_notes(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'title', q.title,
        'body', q.body,
        'status', q.status,
        'published_at', q.published_at,
        'updated_at', q.updated_at,
        'archived_at', q.archived_at,
        'linked_novel_id', q.linked_novel_id,
        'linked_novel_title', q.linked_novel_title
      ) order by q.updated_at desc, q.id desc
    ),
    '[]'::jsonb
  ) into v_result
  from (
    select note.*, novel.title as linked_novel_title
      from public.author_notes note
      left join public.novels novel
        on novel.id = note.linked_novel_id
       and novel.user_id = v_uid
     where note.author_user_id = v_uid
     order by note.updated_at desc, note.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ) q;

  return v_result;
end
$$;

create or replace function public.novelight_save_my_author_note(
  p_note_id bigint,
  p_title text,
  p_body text,
  p_linked_novel_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_note_id bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode='22023', message='Title must be 1 to 80 characters after trimming';
  end if;
  if pg_catalog.char_length(v_body) not between 1 and 1000 then
    raise exception using errcode='22023', message='Body must be 1 to 1000 characters after trimming';
  end if;
  if p_linked_novel_id is not null and not exists (
    select 1 from public.novels novel
     where novel.id = p_linked_novel_id
       and novel.user_id = v_uid
       and novel.status = 'published'
  ) then
    raise exception using errcode='42501', message='Linked novel must be your currently published novel';
  end if;

  if p_note_id is null then
    if (select count(*) from public.author_notes where author_user_id = v_uid and status = 'published') >= 100 then
      raise exception using errcode='22023', message='At most 100 published author notes are allowed';
    end if;
    insert into public.author_notes (
      author_user_id, title, body, linked_novel_id, status,
      published_at, created_at, updated_at
    ) values (
      v_uid, v_title, v_body, p_linked_novel_id, 'published',
      v_now, v_now, v_now
    ) returning id into v_note_id;
  else
    update public.author_notes
       set title = v_title,
           body = v_body,
           linked_novel_id = p_linked_novel_id,
           updated_at = v_now
     where id = p_note_id
       and author_user_id = v_uid
       and status = 'published'
     returning id into v_note_id;
    if v_note_id is null then
      raise exception using errcode='42501', message='Published author note unavailable';
    end if;
  end if;

  return pg_catalog.jsonb_build_object('note_id', v_note_id, 'status', 'published');
end
$$;

create or replace function public.novelight_archive_my_author_note(p_note_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note_id bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  update public.author_notes
     set status = 'archived', archived_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where id = p_note_id and author_user_id = v_uid and status = 'published'
   returning id into v_note_id;
  if v_note_id is null then
    raise exception using errcode='42501', message='Published author note unavailable';
  end if;
  return pg_catalog.jsonb_build_object('note_id', v_note_id, 'status', 'archived');
end
$$;

revoke all on function public.novelight_public_author_notes(uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.novelight_manage_my_author_notes(integer) from public, anon, authenticated, service_role;
revoke all on function public.novelight_save_my_author_note(bigint,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.novelight_archive_my_author_note(bigint) from public, anon, authenticated, service_role;

grant execute on function public.novelight_public_author_notes(uuid,integer) to anon, authenticated;
grant execute on function public.novelight_manage_my_author_notes(integer) to authenticated;
grant execute on function public.novelight_save_my_author_note(bigint,text,text,bigint) to authenticated;
grant execute on function public.novelight_archive_my_author_note(bigint) to authenticated;

comment on table public.author_notes is
  'Private raw storage for small public author updates. No likes, comments, notifications, analytics, Rank, LIGHT SEED, SCOUT, PV, favorites, search, discovery, exposure, or recommendation effects.';
comment on function public.novelight_public_author_notes(uuid,integer) is
  'Public published-note feed. Linked work data is included only while that same-author work is currently published.';

commit;
