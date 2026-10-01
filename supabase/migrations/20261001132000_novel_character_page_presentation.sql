-- Reader-facing novel character presentation, kept separate from appearance detection.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20261001132000'));

alter table public.novels
  add column show_character_images boolean not null default false;

alter table public.novel_characters
  add column summary text not null default '',
  add column image_url text;

alter table public.novel_characters
  add constraint novel_characters_summary_length
    check (char_length(summary) <= 240),
  add constraint novel_characters_image_url_length
    check (image_url is null or char_length(image_url) <= 2048),
  add constraint novel_characters_image_url_https
    check (image_url is null or image_url ~ '^https://');

comment on column public.novels.show_character_images is
  'Whether character image URLs may be exposed on the reader-facing novel page.';
comment on column public.novel_characters.summary is
  'Short spoiler-safe character description shown on the novel page.';
comment on column public.novel_characters.image_url is
  'Optional HTTPS character image URL. Reader feed returns it only when the novel image setting is enabled.';

create or replace function public.novelight_character_page_settings(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_enabled boolean;
begin
  select n.show_character_images
    into v_enabled
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid;

  if v_uid is null or not found then
    raise exception using errcode='42501', message='Character page settings unavailable';
  end if;

  return pg_catalog.jsonb_build_object('show_character_images', v_enabled);
end
$$;

create or replace function public.novelight_set_character_page_images(
  p_novel_id bigint,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_enabled is null then
    raise exception using errcode='42501', message='Character page settings unavailable';
  end if;

  update public.novels
     set show_character_images = p_enabled,
         updated_at = pg_catalog.now()
   where id = p_novel_id
     and user_id = v_uid;

  if not found then
    raise exception using errcode='42501', message='Character page settings unavailable';
  end if;

  return true;
end
$$;

create or replace function public.novelight_update_character_presentation(
  p_character_id bigint,
  p_summary text,
  p_image_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_summary text := pg_catalog.btrim(coalesce(p_summary, ''));
  v_image_url text := nullif(pg_catalog.btrim(coalesce(p_image_url, '')), '');
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Character presentation unavailable';
  end if;
  if char_length(v_summary) > 240 then
    raise exception using errcode='22023', message='Character summary must be 240 characters or fewer';
  end if;
  if v_image_url is not null and (
    char_length(v_image_url) > 2048 or v_image_url !~ '^https://'
  ) then
    raise exception using errcode='22023', message='Character image URL must use HTTPS';
  end if;

  update public.novel_characters c
     set summary = v_summary,
         image_url = v_image_url,
         updated_at = pg_catalog.now()
    from public.novels n
   where c.id = p_character_id
     and n.id = c.novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode='42501', message='Character presentation unavailable';
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
        'summary', q.summary,
        'image_url', q.image_url,
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
        c.summary,
        c.image_url,
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
        select e.id as episode_id, e.episode_number, e.title as episode_title
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
  v_show_images boolean := false;
  v_result jsonb;
begin
  select e.novel_id, e.episode_number, n.show_character_images
    into v_novel_id, v_current_number, v_show_images
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
        'summary', q.summary,
        'image_url', case when v_show_images then q.image_url else null end,
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
        c.summary,
        c.image_url,
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
      group by c.id, c.name, c.summary, c.image_url
    ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_character_page_settings(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_character_page_images(bigint,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_update_character_presentation(bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_author_character_list(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_character_feed(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_character_page_settings(bigint)
  to authenticated;
grant execute on function public.novelight_set_character_page_images(bigint,boolean)
  to authenticated;
grant execute on function public.novelight_update_character_presentation(bigint,text,text)
  to authenticated;
grant execute on function public.novelight_author_character_list(bigint)
  to authenticated;
grant execute on function public.novelight_character_feed(bigint)
  to anon, authenticated;

commit;
