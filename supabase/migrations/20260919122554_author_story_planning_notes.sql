-- NOVELIGHT adopted feature B #23: private author story-planning notes.
--
-- Plot/world notes are private author planning data. Character notes link to the
-- existing canonical novel_characters registry instead of creating a second character identity.
-- Raw notes are never exposed to client roles; authenticated owner-bound RPCs are the only API.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919122554'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.novel_characters') is null then
    raise exception 'B #23 requires existing novels and canonical character registry';
  end if;

  if to_regclass('public.novel_private_story_notes') is not null
     or to_regprocedure('public.novelight_private_story_notes(bigint)') is not null
     or to_regprocedure('public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)') is not null
     or to_regprocedure('public.novelight_delete_private_story_note(bigint)') is not null then
    raise exception 'B #23 private story-note runtime already exists';
  end if;
end
$$;

create table public.novel_private_story_notes (
  id bigint generated always as identity primary key,
  novel_id bigint not null references public.novels(id) on delete cascade,
  note_type text not null,
  character_id bigint references public.novel_characters(id) on delete set null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_private_story_notes_type_valid
    check (note_type in ('plot', 'world', 'character')),
  constraint novel_private_story_notes_title_valid
    check (char_length(btrim(title)) between 1 and 120),
  constraint novel_private_story_notes_body_valid
    check (char_length(body) <= 20000),
  constraint novel_private_story_notes_character_scope_valid
    check (note_type = 'character' or character_id is null)
);

create index novel_private_story_notes_novel_type_updated_idx
  on public.novel_private_story_notes (novel_id, note_type, updated_at desc, id desc);
create index novel_private_story_notes_character_idx
  on public.novel_private_story_notes (character_id)
  where character_id is not null;

alter table public.novel_private_story_notes enable row level security;

revoke all on table public.novel_private_story_notes
  from public, anon, authenticated, service_role;
revoke all on sequence public.novel_private_story_notes_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.novelight_private_story_notes(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Private story notes unavailable';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', note.id,
        'note_type', note.note_type,
        'character_id', note.character_id,
        'character_name', character.name,
        'title', note.title,
        'body', note.body,
        'created_at', note.created_at,
        'updated_at', note.updated_at
      )
      order by note.updated_at desc, note.id desc
    ),
    '[]'::jsonb
  )
    into v_result
    from public.novel_private_story_notes note
    left join public.novel_characters character
      on character.id = note.character_id
     and character.novel_id = note.novel_id
   where note.novel_id = p_novel_id;

  return v_result;
end
$$;

create or replace function public.novelight_save_private_story_note(
  p_novel_id bigint,
  p_note_id bigint,
  p_note_type text,
  p_character_id bigint,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_type text := lower(pg_catalog.btrim(coalesce(p_note_type, '')));
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body, '');
  v_character_id bigint := p_character_id;
  v_note_id bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Private story notes unavailable';
  end if;

  -- Serialize mutations per work so the 200-note cap cannot be exceeded by
  -- concurrent create requests racing the count check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight:b23:notes:' || p_novel_id::text)
  );

  if v_type not in ('plot', 'world', 'character') then
    raise exception using errcode='22023', message='Story note type must be plot, world, or character';
  end if;

  if pg_catalog.char_length(v_title) not between 1 and 120 then
    raise exception using errcode='22023', message='Story note title must be 1 to 120 characters';
  end if;

  if pg_catalog.char_length(v_body) > 20000 then
    raise exception using errcode='22023', message='Story note body must be 20000 characters or fewer';
  end if;

  if v_type = 'character' then
    if v_character_id is null or not exists (
      select 1
        from public.novel_characters c
       where c.id = v_character_id
         and c.novel_id = p_novel_id
    ) then
      raise exception using errcode='22023', message='Character note must reference a character in this work';
    end if;
  else
    v_character_id := null;
  end if;

  if p_note_id is null then
    if (
      select count(*)
        from public.novel_private_story_notes note
       where note.novel_id = p_novel_id
    ) >= 200 then
      raise exception using errcode='22023', message='At most 200 private story notes can be saved per work';
    end if;

    insert into public.novel_private_story_notes (
      novel_id, note_type, character_id, title, body
    ) values (
      p_novel_id, v_type, v_character_id, v_title, v_body
    )
    returning id into v_note_id;
  else
    update public.novel_private_story_notes
       set note_type = v_type,
           character_id = v_character_id,
           title = v_title,
           body = v_body,
           updated_at = pg_catalog.now()
     where id = p_note_id
       and novel_id = p_novel_id
    returning id into v_note_id;

    if v_note_id is null then
      raise exception using errcode='42501', message='Private story note unavailable';
    end if;
  end if;

  return pg_catalog.jsonb_build_object('note_id', v_note_id);
end
$$;

create or replace function public.novelight_delete_private_story_note(
  p_note_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  delete from public.novel_private_story_notes note
  using public.novels n
   where note.id = p_note_id
     and n.id = note.novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode='42501', message='Private story note unavailable';
  end if;

  return true;
end
$$;

revoke all on function public.novelight_private_story_notes(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_delete_private_story_note(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_private_story_notes(bigint)
  to authenticated;
grant execute on function public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)
  to authenticated;
grant execute on function public.novelight_delete_private_story_note(bigint)
  to authenticated;

comment on table public.novel_private_story_notes is
  'Owner-only plot/world/character planning notes. Private author data; never a Rank, SCOUT, PV, favorite, search, discovery, exposure, analytics, or recommendation signal.';
comment on function public.novelight_private_story_notes(bigint) is
  'Owner-only B #23 note feed. Character names come from the existing canonical novel_characters registry.';
comment on function public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text) is
  'Owner-only B #23 create/update endpoint. Collaborators and readers receive no access.';

commit;