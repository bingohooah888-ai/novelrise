-- NOVELIGHT adopted feature: automatic character appearance management.
--
-- One canonical character registry per work. Episode saves update derived appearance
-- evidence through one DB trigger; authors may override include/exclude per episode.
-- Raw character metadata stays private. Reader access is only through a spoiler-safe RPC.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918211545'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Character appearance requires the existing novel, episode, and profile foundations';
  end if;

  if to_regclass('public.novel_characters') is not null
     or to_regclass('public.novel_character_episode_states') is not null
     or to_regprocedure('public.novelight_character_feed(bigint)') is not null
     or to_regprocedure('public.novelight_author_character_list(bigint)') is not null
     or to_regprocedure('public.novelight_episode_character_editor(bigint)') is not null then
    raise exception 'Character appearance runtime already exists';
  end if;
end
$$;

create table public.novel_characters (
  id bigint generated always as identity primary key,
  novel_id bigint not null references public.novels(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}'::text[],
  auto_detect_enabled boolean not null default true,
  reader_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_characters_name_valid
    check (char_length(btrim(name)) between 1 and 80),
  constraint novel_characters_alias_count_valid
    check (cardinality(aliases) <= 12)
);

create unique index novel_characters_novel_name_unique_idx
  on public.novel_characters (novel_id, lower(btrim(name)));
create index novel_characters_novel_idx
  on public.novel_characters (novel_id, id);

create table public.novel_character_episode_states (
  character_id bigint not null references public.novel_characters(id) on delete cascade,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  auto_detected boolean not null default false,
  override_mode text,
  updated_at timestamptz not null default now(),
  primary key (character_id, episode_id),
  constraint novel_character_episode_override_valid
    check (override_mode is null or override_mode in ('include', 'exclude'))
);

create index novel_character_episode_states_episode_idx
  on public.novel_character_episode_states (episode_id, character_id);

alter table public.novel_characters enable row level security;
alter table public.novel_character_episode_states enable row level security;

revoke all on table public.novel_characters
  from public, anon, authenticated, service_role;
revoke all on table public.novel_character_episode_states
  from public, anon, authenticated, service_role;
revoke all on sequence public.novel_characters_id_seq
  from public, anon, authenticated, service_role;

create or replace function public._novelight_character_matches_body(
  p_name text,
  p_aliases text[],
  p_body text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_body, '') = '' then false
    when position(lower(pg_catalog.btrim(p_name)) in lower(p_body)) > 0 then true
    else exists (
      select 1
        from unnest(coalesce(p_aliases, '{}'::text[])) as a(alias)
       where pg_catalog.btrim(a.alias) <> ''
         and position(lower(pg_catalog.btrim(a.alias)) in lower(p_body)) > 0
    )
  end
$$;

create or replace function public._novelight_rescan_character(
  p_character_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_character public.novel_characters%rowtype;
begin
  select *
    into v_character
    from public.novel_characters
   where id = p_character_id;

  if not found then
    return;
  end if;

  update public.novel_character_episode_states
     set auto_detected = false,
         updated_at = pg_catalog.now()
   where character_id = p_character_id
     and auto_detected = true;

  if v_character.auto_detect_enabled then
    insert into public.novel_character_episode_states (
      character_id, episode_id, auto_detected, updated_at
    )
    select
      v_character.id,
      e.id,
      true,
      pg_catalog.now()
      from public.episodes e
     where e.novel_id = v_character.novel_id
       and public._novelight_character_matches_body(
         v_character.name,
         v_character.aliases,
         e.content
       )
    on conflict (character_id, episode_id) do update
      set auto_detected = true,
          updated_at = excluded.updated_at;
  end if;

  delete from public.novel_character_episode_states
   where character_id = p_character_id
     and auto_detected = false
     and override_mode is null;
end
$$;

create or replace function public._novelight_refresh_episode_character_appearances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.novel_character_episode_states s
   using public.novel_characters c
   where s.episode_id = new.id
     and s.character_id = c.id
     and c.novel_id <> new.novel_id;

  update public.novel_character_episode_states s
     set auto_detected = false,
         updated_at = pg_catalog.now()
    from public.novel_characters c
   where s.episode_id = new.id
     and s.character_id = c.id
     and c.novel_id = new.novel_id
     and s.auto_detected = true;

  insert into public.novel_character_episode_states (
    character_id, episode_id, auto_detected, updated_at
  )
  select
    c.id,
    new.id,
    true,
    pg_catalog.now()
    from public.novel_characters c
   where c.novel_id = new.novel_id
     and c.auto_detect_enabled
     and public._novelight_character_matches_body(c.name, c.aliases, new.content)
  on conflict (character_id, episode_id) do update
    set auto_detected = true,
        updated_at = excluded.updated_at;

  delete from public.novel_character_episode_states
   where episode_id = new.id
     and auto_detected = false
     and override_mode is null;

  return new;
end
$$;

create trigger novelight_refresh_episode_character_appearances
after insert or update of content, novel_id on public.episodes
for each row execute function public._novelight_refresh_episode_character_appearances();

revoke all on function public._novelight_character_matches_body(text,text[],text)
  from public, anon, authenticated, service_role;
revoke all on function public._novelight_rescan_character(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public._novelight_refresh_episode_character_appearances()
  from public, anon, authenticated, service_role;

create or replace function public.novelight_upsert_character(
  p_novel_id bigint,
  p_character_id bigint,
  p_name text,
  p_aliases text[],
  p_auto_detect_enabled boolean,
  p_reader_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_aliases text[] := '{}'::text[];
  v_character_id bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  if not exists (
    select 1 from public.novels n
     where n.id = p_novel_id and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  if pg_catalog.char_length(v_name) not between 1 and 80 then
    raise exception using errcode='22023', message='Character name must be 1 to 80 characters';
  end if;

  if exists (
    select 1
      from unnest(coalesce(p_aliases, '{}'::text[])) a(alias)
     where pg_catalog.char_length(pg_catalog.btrim(a.alias)) > 80
  ) then
    raise exception using errcode='22023', message='Character aliases must be 80 characters or fewer';
  end if;

  select coalesce(pg_catalog.array_agg(q.alias order by lower(q.alias)), '{}'::text[])
    into v_aliases
    from (
      select min(pg_catalog.btrim(a.alias)) as alias
        from unnest(coalesce(p_aliases, '{}'::text[])) a(alias)
       where pg_catalog.btrim(a.alias) <> ''
         and lower(pg_catalog.btrim(a.alias)) <> lower(v_name)
       group by lower(pg_catalog.btrim(a.alias))
    ) q;

  if pg_catalog.cardinality(v_aliases) > 12 then
    raise exception using errcode='22023', message='At most 12 aliases can be registered';
  end if;

  if p_character_id is null then
    if (
      select count(*) from public.novel_characters c
       where c.novel_id = p_novel_id
    ) >= 100 then
      raise exception using errcode='22023', message='At most 100 characters can be registered per work';
    end if;

    insert into public.novel_characters (
      novel_id, name, aliases, auto_detect_enabled, reader_visible
    ) values (
      p_novel_id,
      v_name,
      v_aliases,
      coalesce(p_auto_detect_enabled, true),
      coalesce(p_reader_visible, true)
    )
    returning id into v_character_id;
  else
    update public.novel_characters
       set name = v_name,
           aliases = v_aliases,
           auto_detect_enabled = coalesce(p_auto_detect_enabled, true),
           reader_visible = coalesce(p_reader_visible, true),
           updated_at = pg_catalog.now()
     where id = p_character_id
       and novel_id = p_novel_id
    returning id into v_character_id;

    if v_character_id is null then
      raise exception using errcode='42501', message='Character management unavailable';
    end if;
  end if;

  perform public._novelight_rescan_character(v_character_id);

  return pg_catalog.jsonb_build_object('character_id', v_character_id);
end
$$;

create or replace function public.novelight_delete_character(
  p_character_id bigint
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

  delete from public.novel_characters c
   using public.novels n
   where c.id = p_character_id
     and n.id = c.novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  return true;
end
$$;

create or replace function public.novelight_author_character_list(
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
    select 1 from public.novels n
     where n.id = p_novel_id and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'name', q.name,
        'aliases', q.aliases,
        'auto_detect_enabled', q.auto_detect_enabled,
        'reader_visible', q.reader_visible,
        'latest_episode_id', q.latest_episode_id,
        'latest_episode_number', q.latest_episode_number,
        'latest_episode_title', q.latest_episode_title
      )
      order by q.name, q.id
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select
        c.id,
        c.name,
        c.aliases,
        c.auto_detect_enabled,
        c.reader_visible,
        latest.episode_id as latest_episode_id,
        latest.episode_number as latest_episode_number,
        latest.episode_title as latest_episode_title
      from public.novel_characters c
      left join lateral (
        select
          e.id as episode_id,
          e.episode_number,
          e.title as episode_title
        from public.novel_character_episode_states s
        join public.episodes e on e.id = s.episode_id
        where s.character_id = c.id
          and (
            s.override_mode = 'include'
            or (s.override_mode is null and s.auto_detected)
          )
        order by e.episode_number desc, e.id desc
        limit 1
      ) latest on true
      where c.novel_id = p_novel_id
    ) q;

  return v_result;
end
$$;

create or replace function public.novelight_episode_character_editor(
  p_episode_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
  v_result jsonb;
begin
  select e.novel_id
    into v_novel_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and n.user_id = v_uid;

  if v_uid is null or v_novel_id is null then
    raise exception using errcode='42501', message='Character episode management unavailable';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'auto_detect_enabled', c.auto_detect_enabled,
        'reader_visible', c.reader_visible,
        'auto_detected', coalesce(s.auto_detected, false),
        'override_mode', coalesce(s.override_mode, 'auto'),
        'effective', case
          when s.override_mode = 'include' then true
          when s.override_mode = 'exclude' then false
          else coalesce(s.auto_detected, false)
        end
      )
      order by c.name, c.id
    ),
    '[]'::jsonb
  )
    into v_result
    from public.novel_characters c
    left join public.novel_character_episode_states s
      on s.character_id = c.id
     and s.episode_id = p_episode_id
   where c.novel_id = v_novel_id;

  return v_result;
end
$$;

create or replace function public.novelight_set_character_episode_override(
  p_character_id bigint,
  p_episode_id bigint,
  p_override_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_mode text := lower(pg_catalog.btrim(coalesce(p_override_mode, 'auto')));
  v_auto boolean := false;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  if v_mode not in ('auto', 'include', 'exclude') then
    raise exception using errcode='22023', message='Character override must be auto, include, or exclude';
  end if;

  if not exists (
    select 1
      from public.novel_characters c
      join public.novels n on n.id = c.novel_id
      join public.episodes e on e.novel_id = c.novel_id
     where c.id = p_character_id
       and e.id = p_episode_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Character episode management unavailable';
  end if;

  select coalesce((
    select s.auto_detected
      from public.novel_character_episode_states s
     where s.character_id = p_character_id
       and s.episode_id = p_episode_id
  ), false)
    into v_auto;

  if v_mode = 'auto' then
    update public.novel_character_episode_states
       set override_mode = null,
           updated_at = pg_catalog.now()
     where character_id = p_character_id
       and episode_id = p_episode_id;

    delete from public.novel_character_episode_states
     where character_id = p_character_id
       and episode_id = p_episode_id
       and auto_detected = false
       and override_mode is null;
  else
    insert into public.novel_character_episode_states (
      character_id, episode_id, auto_detected, override_mode, updated_at
    ) values (
      p_character_id, p_episode_id, v_auto, v_mode, pg_catalog.now()
    )
    on conflict (character_id, episode_id) do update
      set override_mode = excluded.override_mode,
          updated_at = excluded.updated_at;
  end if;

  return pg_catalog.jsonb_build_object(
    'character_id', p_character_id,
    'episode_id', p_episode_id,
    'override_mode', v_mode
  );
end
$$;

create or replace function public.novelight_character_feed(
  p_episode_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novel_id bigint;
  v_current_number integer;
  v_result jsonb;
begin
  select e.novel_id, e.episode_number
    into v_novel_id, v_current_number
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if v_novel_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'name', q.name,
        'appears_current_episode', q.appears_current_episode,
        'latest_episode_id', q.latest_episode_id,
        'latest_episode_number', q.latest_episode_number,
        'latest_episode_title', q.latest_episode_title
      )
      order by
        q.appears_current_episode desc,
        q.latest_episode_number desc,
        q.name,
        q.id
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select
        c.id,
        c.name,
        pg_catalog.bool_or(
          e.id = p_episode_id
          and (
            s.override_mode = 'include'
            or (s.override_mode is null and s.auto_detected)
          )
        ) as appears_current_episode,
        (pg_catalog.array_agg(e.id order by e.episode_number desc, e.id desc))[1]
          as latest_episode_id,
        max(e.episode_number) as latest_episode_number,
        (pg_catalog.array_agg(e.title order by e.episode_number desc, e.id desc))[1]
          as latest_episode_title
      from public.novel_characters c
      join public.novel_character_episode_states s on s.character_id = c.id
      join public.episodes e on e.id = s.episode_id
      where c.novel_id = v_novel_id
        and c.reader_visible
        and e.novel_id = v_novel_id
        and e.status = 'published'
        and e.episode_number <= v_current_number
        and (
          s.override_mode = 'include'
          or (s.override_mode is null and s.auto_detected)
        )
      group by c.id, c.name
    ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_delete_character(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_author_character_list(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_episode_character_editor(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_character_episode_override(bigint,bigint,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_character_feed(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)
  to authenticated;
grant execute on function public.novelight_delete_character(bigint)
  to authenticated;
grant execute on function public.novelight_author_character_list(bigint)
  to authenticated;
grant execute on function public.novelight_episode_character_editor(bigint)
  to authenticated;
grant execute on function public.novelight_set_character_episode_override(bigint,bigint,text)
  to authenticated;
grant execute on function public.novelight_character_feed(bigint)
  to anon, authenticated;

comment on table public.novel_characters is
  'Private author-managed character registry. Never a Rank, SCOUT, PV, favorite, discovery, or exposure signal.';
comment on table public.novel_character_episode_states is
  'Derived/manual character appearance state per episode. Manual include/exclude overrides automatic detection.';
comment on function public.novelight_character_feed(bigint) is
  'Spoiler-safe reader feed: only reader-visible characters effectively appearing in published episodes up to the current episode.';
comment on function public.novelight_set_character_episode_override(bigint,bigint,text) is
  'Owner-only per-episode override. auto returns control to body-based detection; include/exclude are explicit author decisions.';

commit;
