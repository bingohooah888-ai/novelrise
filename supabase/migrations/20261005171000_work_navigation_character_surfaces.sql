-- NOVELIGHT work navigation / character surface controls.
-- Existing reader_visible remains the master public switch.
-- New surfaces default OFF so existing characters do not suddenly appear.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20261005171000'));

alter table public.novel_characters
  add column if not exists reader_body_visible boolean not null default false,
  add column if not exists novel_detail_visible boolean not null default false,
  add column if not exists display_order integer not null default 0;

alter table public.novel_characters
  drop constraint if exists novel_characters_display_order_range,
  add constraint novel_characters_display_order_range
    check (display_order between -100000 and 100000);

comment on column public.novel_characters.reader_body_visible is
  'Author-controlled reader episode surface flag. Requires reader_visible as well. Existing rows default OFF.';
comment on column public.novel_characters.novel_detail_visible is
  'Author-controlled work detail surface flag. Requires reader_visible as well. Existing rows default OFF.';
comment on column public.novel_characters.display_order is
  'Author-controlled stable display order for reader character surfaces; lower values appear first.';

create or replace function public.novelight_upsert_character_v4(
  p_novel_id bigint,
  p_character_id bigint,
  p_name text,
  p_aliases text[],
  p_auto_detect_enabled boolean,
  p_reader_visible boolean,
  p_first_appearance_episode_id bigint,
  p_description text,
  p_image_url text,
  p_reader_body_visible boolean,
  p_novel_detail_visible boolean,
  p_display_order integer
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
  v_order integer := coalesce(p_display_order, 0);
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if v_order < -100000 or v_order > 100000 then
    raise exception using errcode='22023', message='Character display order is out of range';
  end if;

  v_result := public.novelight_upsert_character_v3(
    p_novel_id,
    p_character_id,
    p_name,
    p_aliases,
    p_auto_detect_enabled,
    p_reader_visible,
    p_first_appearance_episode_id,
    p_description,
    p_image_url
  );

  v_character_id := nullif(v_result ->> 'character_id', '')::bigint;
  if v_character_id is null then
    raise exception 'Character save did not return an id';
  end if;

  update public.novel_characters c
     set reader_body_visible = coalesce(p_reader_body_visible, false),
         novel_detail_visible = coalesce(p_novel_detail_visible, false),
         display_order = v_order,
         updated_at = pg_catalog.now()
   where c.id = v_character_id
     and c.novel_id = p_novel_id
     and exists (
       select 1 from public.novels n
       where n.id = c.novel_id and n.user_id = v_uid
     );

  if not found then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'reader_body_visible', coalesce(p_reader_body_visible, false),
    'novel_detail_visible', coalesce(p_novel_detail_visible, false),
    'display_order', v_order
  );
end
$$;

revoke all on function public.novelight_upsert_character_v4(bigint,bigint,text,text[],boolean,boolean,bigint,text,text,boolean,boolean,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.novelight_upsert_character_v4(bigint,bigint,text,text[],boolean,boolean,bigint,text,text,boolean,boolean,integer)
  to authenticated;

create or replace function public.novelight_author_character_list(p_novel_id bigint)
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
    select 1 from public.novels n where n.id = p_novel_id and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,
    'name',q.name,
    'aliases',q.aliases,
    'description',q.description,
    'image_url',q.image_url,
    'auto_detect_enabled',q.auto_detect_enabled,
    'reader_visible',q.reader_visible,
    'reader_body_visible',q.reader_body_visible,
    'novel_detail_visible',q.novel_detail_visible,
    'display_order',q.display_order,
    'first_appearance_episode_id',q.first_appearance_episode_id,
    'first_appearance_episode_number',q.first_appearance_episode_number,
    'first_appearance_episode_title',q.first_appearance_episode_title,
    'latest_episode_id',q.latest_episode_id,
    'latest_episode_number',q.latest_episode_number,
    'latest_episode_title',q.latest_episode_title
  ) order by q.display_order,q.name,q.id), '[]'::jsonb)
  into v_result
  from (
    select c.id,c.name,c.aliases,c.description,c.image_url,c.auto_detect_enabled,c.reader_visible,
      c.reader_body_visible,c.novel_detail_visible,c.display_order,c.first_appearance_episode_id,
      first_episode.episode_number as first_appearance_episode_number,
      first_episode.title as first_appearance_episode_title,
      latest.episode_id as latest_episode_id,
      latest.episode_number as latest_episode_number,
      latest.episode_title as latest_episode_title
    from public.novel_characters c
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id and first_episode.novel_id = c.novel_id
    left join lateral (
      select e.id as episode_id,e.episode_number,e.title as episode_title
      from public.novel_character_episode_states s
      join public.episodes e on e.id = s.episode_id
      where s.character_id = c.id
        and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))
      order by e.episode_number desc,e.id desc
      limit 1
    ) latest on true
    where c.novel_id = p_novel_id
  ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_author_character_list(bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.novelight_author_character_list(bigint) to authenticated;

create or replace function public.novelight_character_feed(p_episode_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_novel_id bigint;
  v_current_number integer;
  v_show_images boolean := false;
  v_result jsonb;
begin
  select e.novel_id,e.episode_number,n.character_images_visible
    into v_novel_id,v_current_number,v_show_images
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id and e.status = 'published' and n.status = 'published';

  if v_novel_id is null then return '[]'::jsonb; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,
    'name',q.name,
    'description',q.description,
    'image_url',case when v_show_images then q.image_url else null end,
    'appears_current_episode',q.appears_current_episode,
    'latest_episode_id',q.latest_episode_id,
    'latest_episode_number',q.latest_episode_number,
    'latest_episode_title',q.latest_episode_title
  ) order by q.display_order,q.appears_current_episode desc,q.latest_episode_number desc,q.name,q.id), '[]'::jsonb)
  into v_result
  from (
    select c.id,c.name,c.description,c.image_url,c.display_order,
      pg_catalog.bool_or(e.id = p_episode_id and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))) as appears_current_episode,
      (pg_catalog.array_agg(e.id order by e.episode_number desc,e.id desc))[1] as latest_episode_id,
      max(e.episode_number) as latest_episode_number,
      (pg_catalog.array_agg(e.title order by e.episode_number desc,e.id desc))[1] as latest_episode_title
    from public.novel_characters c
    join public.novel_character_episode_states s on s.character_id = c.id
    join public.episodes e on e.id = s.episode_id
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id
      and first_episode.novel_id = c.novel_id
      and first_episode.status = 'published'
    where c.novel_id = v_novel_id
      and c.reader_visible
      and c.reader_body_visible
      and e.novel_id = v_novel_id
      and e.status = 'published'
      and e.episode_number <= v_current_number
      and (c.first_appearance_episode_id is null or (first_episode.id is not null and first_episode.episode_number <= v_current_number))
      and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))
    group by c.id,c.name,c.description,c.image_url,c.display_order
  ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_character_feed(bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.novelight_character_feed(bigint) to anon,authenticated;

create or replace function public.novelight_novel_character_feed(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_show_images boolean := false;
  v_reveal_through bigint := 0;
  v_result jsonb;
begin
  select n.user_id,n.character_images_visible
    into v_author_id,v_show_images
  from public.novels n
  where n.id = p_novel_id and n.status = 'published';

  if not found then return '[]'::jsonb; end if;

  if v_uid is not null and v_uid = v_author_id then
    v_reveal_through := 9223372036854775807::bigint;
  elsif v_uid is not null then
    select coalesce(max(e.episode_number),0)::bigint
      into v_reveal_through
    from public.valid_read_events vr
    join public.episodes e
      on e.id::text = vr.episode_id_snapshot
     and e.novel_id = p_novel_id
     and e.status = 'published'
    where vr.reader_id = v_uid
      and vr.novel_id_snapshot = p_novel_id::text;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,
    'name',q.name,
    'description',q.description,
    'image_url',case when v_show_images then q.image_url else null end,
    'first_appearance_episode_number',q.first_appearance_episode_number
  ) order by q.display_order,q.name,q.id), '[]'::jsonb)
  into v_result
  from (
    select
      c.id,
      c.name,
      c.description,
      c.image_url,
      c.display_order,
      coalesce(
        first_episode.episode_number,
        (
          select min(e2.episode_number)
          from public.novel_character_episode_states s2
          join public.episodes e2 on e2.id = s2.episode_id
          where s2.character_id = c.id
            and e2.novel_id = p_novel_id
            and e2.status = 'published'
            and (s2.override_mode = 'include' or (s2.override_mode is null and s2.auto_detected))
        )
      ) as first_appearance_episode_number
    from public.novel_characters c
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id
      and first_episode.novel_id = c.novel_id
      and first_episode.status = 'published'
    where c.novel_id = p_novel_id
      and c.reader_visible
      and c.novel_detail_visible
  ) q
  where q.first_appearance_episode_number is not null
    and q.first_appearance_episode_number <= v_reveal_through;

  return v_result;
end
$$;

revoke all on function public.novelight_novel_character_feed(bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.novelight_novel_character_feed(bigint) to anon,authenticated;

comment on function public.novelight_character_feed(bigint) is
  'Spoiler-safe reader episode character feed. New episode surface is opt-in and respects first-appearance publication boundary.';
comment on function public.novelight_novel_character_feed(bigint) is
  'Reader-safe work-detail character feed. Returns only public presentation fields for opt-in characters.';

commit;
