-- NOVELIGHT beta feedback: character first-appearance boundary, public outline titles,
-- and chapter metadata updates that never renumber episodes.
--
-- Scope is deliberately narrow:
--   * first_appearance_episode_id is optional and backward compatible;
--   * manual include/exclude remains the final authority for character appearance;
--   * only the normal novel outline exposes published titles regardless of read state;
--   * reader continuation / notification spoiler boundaries are untouched;
--   * chapter-only metadata saves never write episodes.episode_number.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20261001080000'));

do $$
begin
  if to_regclass('public.novel_characters') is null
     or to_regclass('public.novel_character_episode_states') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.novel_chapters') is null
     or to_regprocedure('public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)') is null
     or to_regprocedure('public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)') is null
     or to_regprocedure('public.novelight_novel_outline(bigint)') is null then
    raise exception 'Required NOVELIGHT character/chapter/outline foundations are missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_characters'
       and column_name = 'first_appearance_episode_id'
  ) then
    raise exception 'first_appearance_episode_id already exists; inspect before applying this migration';
  end if;
end
$$;

alter table public.novel_characters
  add column first_appearance_episode_id bigint
  references public.episodes(id) on delete set null;

create index novel_characters_first_appearance_episode_idx
  on public.novel_characters (first_appearance_episode_id)
  where first_appearance_episode_id is not null;

comment on column public.novel_characters.first_appearance_episode_id is
  'Optional first episode eligible for automatic character detection. NULL preserves legacy all-episode detection; manual per-episode overrides still win.';

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
       and (
         v_character.first_appearance_episode_id is null
         or exists (
           select 1
             from public.episodes first_episode
            where first_episode.id = v_character.first_appearance_episode_id
              and first_episode.novel_id = v_character.novel_id
              and e.episode_number >= first_episode.episode_number
         )
       )
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

revoke all on function public._novelight_rescan_character(bigint)
  from public, anon, authenticated, service_role;

-- Episode numbering can change in a multi-row reorder. Refresh after each completed
-- UPDATE statement so the final statement sees one consistent numbering state.
create or replace function public._novelight_rescan_characters_after_episode_number_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from new_episode_rows new_row
      join old_episode_rows old_row on old_row.id = new_row.id
     where new_row.episode_number is distinct from old_row.episode_number
  ) then
    return null;
  end if;

  perform public._novelight_rescan_character(c.id)
    from public.novel_characters c
   where c.novel_id in (
     select distinct new_row.novel_id
       from new_episode_rows new_row
       join old_episode_rows old_row on old_row.id = new_row.id
      where new_row.episode_number is distinct from old_row.episode_number
   );

  return null;
end
$$;

revoke all on function public._novelight_rescan_characters_after_episode_number_change()
  from public, anon, authenticated, service_role;

drop trigger if exists novelight_rescan_characters_after_episode_number_change on public.episodes;
create trigger novelight_rescan_characters_after_episode_number_change
after update on public.episodes
referencing old table as old_episode_rows new table as new_episode_rows
for each statement execute function public._novelight_rescan_characters_after_episode_number_change();

-- Keep the original RPC contract untouched for older clients. New character-management
-- UI uses this versioned RPC so the new field can be saved atomically.
create or replace function public.novelight_upsert_character_v2(
  p_novel_id bigint,
  p_character_id bigint,
  p_name text,
  p_aliases text[],
  p_auto_detect_enabled boolean,
  p_reader_visible boolean,
  p_first_appearance_episode_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_character_id bigint;
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
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  if p_first_appearance_episode_id is not null
     and not exists (
       select 1
         from public.episodes e
        where e.id = p_first_appearance_episode_id
          and e.novel_id = p_novel_id
          and e.user_id = v_uid
     ) then
    raise exception using errcode='22023', message='First appearance episode must belong to this work';
  end if;

  v_result := public.novelight_upsert_character(
    p_novel_id,
    p_character_id,
    p_name,
    p_aliases,
    p_auto_detect_enabled,
    p_reader_visible
  );

  v_character_id := nullif(v_result ->> 'character_id', '')::bigint;
  if v_character_id is null then
    raise exception 'Character save did not return an id';
  end if;

  update public.novel_characters
     set first_appearance_episode_id = p_first_appearance_episode_id,
         updated_at = pg_catalog.now()
   where id = v_character_id
     and novel_id = p_novel_id;

  if not found then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  perform public._novelight_rescan_character(v_character_id);

  return pg_catalog.jsonb_build_object(
    'character_id', v_character_id,
    'first_appearance_episode_id', p_first_appearance_episode_id
  );
end
$$;

revoke all on function public.novelight_upsert_character_v2(bigint,bigint,text,text[],boolean,boolean,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_upsert_character_v2(bigint,bigint,text,text[],boolean,boolean,bigint)
  to authenticated;

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
        'first_appearance_episode_id', q.first_appearance_episode_id,
        'first_appearance_episode_number', q.first_appearance_episode_number,
        'first_appearance_episode_title', q.first_appearance_episode_title,
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
        c.first_appearance_episode_id,
        first_episode.episode_number as first_appearance_episode_number,
        first_episode.title as first_appearance_episode_title,
        latest.episode_id as latest_episode_id,
        latest.episode_number as latest_episode_number,
        latest.episode_title as latest_episode_title
      from public.novel_characters c
      left join public.episodes first_episode
        on first_episode.id = c.first_appearance_episode_id
       and first_episode.novel_id = c.novel_id
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

revoke all on function public.novelight_author_character_list(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_author_character_list(bigint)
  to authenticated;

-- Chapter membership and chapter order are metadata changes. This RPC deliberately
-- validates the complete structure but never writes episodes.episode_number.
create or replace function public.novelight_update_novel_structure_metadata(
  p_novel_id bigint,
  p_episode_items jsonb,
  p_chapter_order jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_episode_count integer;
  v_chapter_count integer;
  v_requested_episode_count integer;
  v_requested_chapter_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;
  if p_episode_items is null or jsonb_typeof(p_episode_items) <> 'array' then
    raise exception 'Episode metadata must be a JSON array' using errcode = '22023';
  end if;
  if p_chapter_order is null or jsonb_typeof(p_chapter_order) <> 'array' then
    raise exception 'Chapter ordering must be a JSON array' using errcode = '22023';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_user_id
   for update;
  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  select count(*)::integer
    into v_episode_count
    from public.episodes e
   where e.novel_id = p_novel_id;

  select count(*)::integer
    into v_chapter_count
    from public.novel_chapters c
   where c.novel_id = p_novel_id;

  if v_episode_count > 1000 then
    raise exception 'A single structure update can contain at most 1000 episodes' using errcode = '22023';
  end if;
  if v_chapter_count > 200 then
    raise exception 'A single structure update can contain at most 200 chapters' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_requested_episode_count
    from jsonb_array_elements(p_episode_items);
  select count(*)::integer
    into v_requested_chapter_count
    from jsonb_array_elements(p_chapter_order);

  if v_requested_episode_count <> v_episode_count then
    raise exception 'Episode metadata must contain every episode exactly once' using errcode = '22023';
  end if;
  if v_requested_chapter_count <> v_chapter_count then
    raise exception 'Chapter ordering must contain every chapter exactly once' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_episode_items) item
     where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'episode_id', '') !~ '^[1-9][0-9]*$'
        or (
          item ? 'chapter_id'
          and jsonb_typeof(item -> 'chapter_id') <> 'null'
          and coalesce(item ->> 'chapter_id', '') !~ '^[1-9][0-9]*$'
        )
  ) then
    raise exception 'Each episode item requires a positive episode_id and an optional positive chapter_id' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements_text(p_chapter_order) value
     where value !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Each chapter id must be a positive integer' using errcode = '22023';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_episode_items)
  ) <> (
    select count(distinct (item ->> 'episode_id')::bigint)
      from jsonb_array_elements(p_episode_items) item
  ) then
    raise exception 'Episode metadata contains duplicate episode ids' using errcode = '22023';
  end if;

  if (
    select count(*) from jsonb_array_elements_text(p_chapter_order)
  ) <> (
    select count(distinct value::bigint)
      from jsonb_array_elements_text(p_chapter_order) value
  ) then
    raise exception 'Chapter ordering contains duplicate chapter ids' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_episode_items) item
     where not exists (
       select 1
         from public.episodes e
        where e.id = (item ->> 'episode_id')::bigint
          and e.novel_id = p_novel_id
          and e.user_id = v_user_id
     )
  ) then
    raise exception 'Episode metadata contains an episode outside the owned novel' using errcode = '42501';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_episode_items) item
     where item ? 'chapter_id'
       and jsonb_typeof(item -> 'chapter_id') <> 'null'
       and not exists (
         select 1
           from public.novel_chapters c
          where c.id = (item ->> 'chapter_id')::bigint
            and c.novel_id = p_novel_id
       )
  ) then
    raise exception 'Episode metadata contains a chapter outside the owned novel' using errcode = '42501';
  end if;

  if exists (
    select 1
      from jsonb_array_elements_text(p_chapter_order) value
     where not exists (
       select 1
         from public.novel_chapters c
        where c.id = value::bigint
          and c.novel_id = p_novel_id
     )
  ) then
    raise exception 'Chapter ordering contains a chapter outside the owned novel' using errcode = '42501';
  end if;

  perform 1
    from public.episodes e
   where e.novel_id = p_novel_id
   order by e.id
   for update;
  perform 1
    from public.novel_chapters c
   where c.novel_id = p_novel_id
   order by c.id
   for update;

  with desired as (
    select
      (item ->> 'episode_id')::bigint as episode_id,
      case
        when item ? 'chapter_id' and jsonb_typeof(item -> 'chapter_id') <> 'null'
          then (item ->> 'chapter_id')::bigint
        else null
      end as chapter_id
      from jsonb_array_elements(p_episode_items) item
  )
  update public.episodes e
     set chapter_id = desired.chapter_id
    from desired
   where e.id = desired.episode_id
     and e.novel_id = p_novel_id
     and e.chapter_id is distinct from desired.chapter_id;

  update public.novel_chapters c
     set position = -c.position,
         updated_at = now()
   where c.novel_id = p_novel_id;

  with desired as (
    select value::bigint as chapter_id,
           ordinality::bigint as new_position
      from jsonb_array_elements_text(p_chapter_order) with ordinality as requested(value, ordinality)
  )
  update public.novel_chapters c
     set position = desired.new_position,
         updated_at = now()
    from desired
   where c.id = desired.chapter_id
     and c.novel_id = p_novel_id;

  return true;
end
$$;

revoke all on function public.novelight_update_novel_structure_metadata(bigint,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_update_novel_structure_metadata(bigint,jsonb,jsonb)
  to authenticated, service_role;

comment on function public.novelight_update_novel_structure_metadata(bigint,jsonb,jsonb) is
  'Owner-only chapter membership/order update. Never changes episodes.episode_number; explicit episode moves continue to use novelight_reorder_novel_structure.';

-- The normal work-detail table of contents is an intentional browsing surface.
-- Expose titles for public episodes there, while preserving the existing visibility
-- predicate that excludes drafts / unreleased episodes for non-owners. Other spoiler-
-- safe surfaces (reader index, updates, notifications, character feed) remain untouched.
create or replace function public.novelight_novel_outline(
  p_novel_id bigint
)
returns table (
  episode_id bigint,
  episode_title text,
  episode_number bigint,
  episode_status text,
  chapter_id bigint,
  chapter_title text,
  chapter_position bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_novel_status text;
  v_is_owner boolean := false;
begin
  if p_novel_id is null then
    return;
  end if;

  select n.user_id, n.status
    into v_owner_id, v_novel_status
    from public.novels n
   where n.id = p_novel_id;

  if not found then
    return;
  end if;

  v_is_owner := v_user_id is not null and v_user_id = v_owner_id;
  if not v_is_owner and v_novel_status <> 'published' then
    return;
  end if;

  return query
  select
    e.id,
    e.title,
    e.episode_number,
    e.status,
    c.id,
    c.title,
    c.position
  from public.episodes e
  left join public.novel_chapters c
    on c.id = e.chapter_id
   and c.novel_id = e.novel_id
  where e.novel_id = p_novel_id
    and (
      v_is_owner
      or (v_novel_status = 'published' and e.status = 'published')
    )
  order by e.episode_number, e.id;
end
$$;

revoke all on function public.novelight_novel_outline(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_novel_outline(bigint)
  to anon, authenticated, service_role;

comment on function public.novelight_novel_outline(bigint) is
  'Normal work-detail table of contents. Non-owners receive published episodes only, with public episode/chapter titles regardless of read state.';

commit;
