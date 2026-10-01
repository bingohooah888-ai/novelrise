-- Reader-facing character cards for the work detail page.
-- Optional presentation metadata plus a work-level image visibility switch.
-- The public feed remains spoiler-safe and never returns image URLs while the switch is OFF.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20261001134500'));

do $$
begin
  if to_regclass('public.novel_characters') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regprocedure('public.novelight_upsert_character_v2(bigint,bigint,text,text[],boolean,boolean,bigint)') is null
     or to_regprocedure('public.novelight_character_feed(bigint)') is null then
    raise exception 'Required NOVELIGHT character foundations are missing';
  end if;
end
$$;

alter table public.novel_characters
  add column if not exists description text not null default '',
  add column if not exists image_url text;

alter table public.novels
  add column if not exists character_images_visible boolean not null default true;

alter table public.novel_characters
  drop constraint if exists novel_characters_description_length,
  add constraint novel_characters_description_length check (pg_catalog.char_length(description) <= 300),
  drop constraint if exists novel_characters_image_url_valid,
  add constraint novel_characters_image_url_valid check (
    image_url is null
    or (pg_catalog.char_length(image_url) <= 2048 and image_url ~ '^https://')
  );

comment on column public.novel_characters.description is 'Optional short reader-facing character description. Maximum 300 characters.';
comment on column public.novel_characters.image_url is 'Optional HTTPS character image URL. Public feed suppresses this value when the work-level image switch is OFF.';
comment on column public.novels.character_images_visible is 'Author-controlled switch for reader work pages. false means public character feeds do not expose character image URLs.';

create or replace function public.novelight_upsert_character_v3(
  p_novel_id bigint,
  p_character_id bigint,
  p_name text,
  p_aliases text[],
  p_auto_detect_enabled boolean,
  p_reader_visible boolean,
  p_first_appearance_episode_id bigint,
  p_description text,
  p_image_url text
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
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_image_url text := nullif(pg_catalog.btrim(coalesce(p_image_url, '')), '');
begin
  if v_uid is null then raise exception using errcode='42501', message='Authentication required'; end if;
  if pg_catalog.char_length(v_description) > 300 then raise exception using errcode='22023', message='Character description must be 300 characters or fewer'; end if;
  if v_image_url is not null and (pg_catalog.char_length(v_image_url) > 2048 or v_image_url !~ '^https://') then
    raise exception using errcode='22023', message='Character image URL must be an HTTPS URL';
  end if;

  v_result := public.novelight_upsert_character_v2(
    p_novel_id,p_character_id,p_name,p_aliases,p_auto_detect_enabled,p_reader_visible,p_first_appearance_episode_id
  );
  v_character_id := nullif(v_result ->> 'character_id', '')::bigint;
  if v_character_id is null then raise exception 'Character save did not return an id'; end if;

  update public.novel_characters c
     set description=v_description,image_url=v_image_url,updated_at=pg_catalog.now()
   where c.id=v_character_id
     and c.novel_id=p_novel_id
     and exists(select 1 from public.novels n where n.id=c.novel_id and n.user_id=v_uid);
  if not found then raise exception using errcode='42501', message='Character management unavailable'; end if;

  return pg_catalog.jsonb_build_object('character_id',v_character_id,'first_appearance_episode_id',p_first_appearance_episode_id,'description',v_description,'image_url',v_image_url);
end
$$;
revoke all on function public.novelight_upsert_character_v3(bigint,bigint,text,text[],boolean,boolean,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.novelight_upsert_character_v3(bigint,bigint,text,text[],boolean,boolean,bigint,text,text) to authenticated;

create or replace function public.novelight_set_character_images_visible(p_novel_id bigint,p_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception using errcode='42501', message='Authentication required'; end if;
  update public.novels n set character_images_visible=coalesce(p_visible,false) where n.id=p_novel_id and n.user_id=v_uid;
  if not found then raise exception using errcode='42501', message='Character settings unavailable'; end if;
  return true;
end
$$;
revoke all on function public.novelight_set_character_images_visible(bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.novelight_set_character_images_visible(bigint,boolean) to authenticated;

create or replace function public.novelight_author_character_settings(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_visible boolean;
begin
  if v_uid is null then raise exception using errcode='42501', message='Authentication required'; end if;
  select n.character_images_visible into v_visible from public.novels n where n.id=p_novel_id and n.user_id=v_uid;
  if not found then raise exception using errcode='42501', message='Character settings unavailable'; end if;
  return pg_catalog.jsonb_build_object('character_images_visible',v_visible);
end
$$;
revoke all on function public.novelight_author_character_settings(bigint) from public,anon,authenticated,service_role;
grant execute on function public.novelight_author_character_settings(bigint) to authenticated;

create or replace function public.novelight_author_character_list(p_novel_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_result jsonb;
begin
  if v_uid is null or not exists(select 1 from public.novels n where n.id=p_novel_id and n.user_id=v_uid) then
    raise exception using errcode='42501', message='Character management unavailable';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,'name',q.name,'aliases',q.aliases,'description',q.description,'image_url',q.image_url,
    'auto_detect_enabled',q.auto_detect_enabled,'reader_visible',q.reader_visible,
    'first_appearance_episode_id',q.first_appearance_episode_id,'first_appearance_episode_number',q.first_appearance_episode_number,'first_appearance_episode_title',q.first_appearance_episode_title,
    'latest_episode_id',q.latest_episode_id,'latest_episode_number',q.latest_episode_number,'latest_episode_title',q.latest_episode_title
  ) order by q.name,q.id),'[]'::jsonb)
  into v_result
  from (
    select c.id,c.name,c.aliases,c.description,c.image_url,c.auto_detect_enabled,c.reader_visible,c.first_appearance_episode_id,
      first_episode.episode_number as first_appearance_episode_number,first_episode.title as first_appearance_episode_title,
      latest.episode_id as latest_episode_id,latest.episode_number as latest_episode_number,latest.episode_title as latest_episode_title
    from public.novel_characters c
    left join public.episodes first_episode on first_episode.id=c.first_appearance_episode_id and first_episode.novel_id=c.novel_id
    left join lateral (
      select e.id as episode_id,e.episode_number,e.title as episode_title
      from public.novel_character_episode_states s join public.episodes e on e.id=s.episode_id
      where s.character_id=c.id and (s.override_mode='include' or (s.override_mode is null and s.auto_detected))
      order by e.episode_number desc,e.id desc limit 1
    ) latest on true
    where c.novel_id=p_novel_id
  ) q;
  return v_result;
end
$$;
revoke all on function public.novelight_author_character_list(bigint) from public,anon,authenticated,service_role;
grant execute on function public.novelight_author_character_list(bigint) to authenticated;

create or replace function public.novelight_character_feed(p_episode_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_novel_id bigint; v_current_number integer; v_show_images boolean := false; v_result jsonb;
begin
  select e.novel_id,e.episode_number,n.character_images_visible into v_novel_id,v_current_number,v_show_images
  from public.episodes e join public.novels n on n.id=e.novel_id
  where e.id=p_episode_id and e.status='published' and n.status='published';
  if v_novel_id is null then return '[]'::jsonb; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,'name',q.name,'description',q.description,'image_url',case when v_show_images then q.image_url else null end,
    'appears_current_episode',q.appears_current_episode,'latest_episode_id',q.latest_episode_id,'latest_episode_number',q.latest_episode_number,'latest_episode_title',q.latest_episode_title
  ) order by q.appears_current_episode desc,q.latest_episode_number desc,q.name,q.id),'[]'::jsonb)
  into v_result
  from (
    select c.id,c.name,c.description,c.image_url,
      pg_catalog.bool_or(e.id=p_episode_id and (s.override_mode='include' or (s.override_mode is null and s.auto_detected))) as appears_current_episode,
      (pg_catalog.array_agg(e.id order by e.episode_number desc,e.id desc))[1] as latest_episode_id,
      max(e.episode_number) as latest_episode_number,
      (pg_catalog.array_agg(e.title order by e.episode_number desc,e.id desc))[1] as latest_episode_title
    from public.novel_characters c
    join public.novel_character_episode_states s on s.character_id=c.id
    join public.episodes e on e.id=s.episode_id
    where c.novel_id=v_novel_id and c.reader_visible and e.novel_id=v_novel_id and e.status='published' and e.episode_number<=v_current_number
      and (s.override_mode='include' or (s.override_mode is null and s.auto_detected))
    group by c.id,c.name,c.description,c.image_url
  ) q;
  return v_result;
end
$$;
revoke all on function public.novelight_character_feed(bigint) from public,anon,authenticated,service_role;
grant execute on function public.novelight_character_feed(bigint) to anon,authenticated;

comment on function public.novelight_character_feed(bigint) is 'Spoiler-safe reader feed for the current reading boundary. Character image URLs are omitted when the author disables character images for the work.';

commit;
