-- NOVELIGHT competitor audit B-C item #21: reader curation lists.
-- Lists are share-by-link only during beta and never affect Rank, LIGHT SEED, SCOUT,
-- PV, favorites, search order, discovery shelves, exposure, analytics, or recommendations.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919102000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null then
    raise exception '#21 reader curation requires profiles and novels';
  end if;
  if to_regclass('public.reader_curation_lists') is not null
     or to_regclass('public.reader_curation_list_items') is not null
     or to_regprocedure('public.novelight_public_reader_curation(uuid)') is not null then
    raise exception '#21 reader curation runtime already exists';
  end if;
end
$$;

create table public.reader_curation_lists (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  visibility text not null default 'private',
  share_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reader_curation_lists_title_valid
    check (char_length(btrim(title)) between 1 and 80),
  constraint reader_curation_lists_description_valid
    check (char_length(description) <= 500),
  constraint reader_curation_lists_visibility_valid
    check (visibility in ('private', 'shared'))
);

create unique index reader_curation_lists_owner_title_idx
  on public.reader_curation_lists (owner_user_id, lower(btrim(title)));
create unique index reader_curation_lists_share_token_idx
  on public.reader_curation_lists (share_token);
create index reader_curation_lists_owner_updated_idx
  on public.reader_curation_lists (owner_user_id, updated_at desc, id desc);

create table public.reader_curation_list_items (
  list_id bigint not null references public.reader_curation_lists(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  primary key (list_id, novel_id),
  constraint reader_curation_list_items_position_positive check (position > 0),
  constraint reader_curation_list_items_list_position_unique unique (list_id, position)
);

create index reader_curation_list_items_novel_idx
  on public.reader_curation_list_items (novel_id, list_id);

alter table public.reader_curation_lists enable row level security;
alter table public.reader_curation_list_items enable row level security;

revoke all on table public.reader_curation_lists
  from public, anon, authenticated, service_role;
revoke all on table public.reader_curation_list_items
  from public, anon, authenticated, service_role;
revoke all on sequence public.reader_curation_lists_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.novelight_manage_my_curation_lists()
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
        'list_id', list.id,
        'title', list.title,
        'description', list.description,
        'visibility', list.visibility,
        'share_token', list.share_token,
        'created_at', list.created_at,
        'updated_at', list.updated_at,
        'items', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'novel_id', item.novel_id,
              'position', item.position,
              'available', novel.id is not null,
              'title', case when novel.id is not null then novel.title else null end,
              'genre', case when novel.id is not null then novel.genre else null end
            )
            order by item.position, item.added_at, item.novel_id
          )
          from public.reader_curation_list_items item
          left join public.novels novel
            on novel.id = item.novel_id
           and novel.status = 'published'
          where item.list_id = list.id
        ), '[]'::jsonb)
      )
      order by list.updated_at desc, list.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.reader_curation_lists list
  where list.owner_user_id = v_uid;

  return v_result;
end
$$;

create or replace function public.novelight_create_my_curation_list(
  p_title text,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := coalesce(p_description, '');
  v_list record;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode='22023', message='Title must be 1 to 80 characters after trimming';
  end if;
  if pg_catalog.char_length(v_description) > 500 then
    raise exception using errcode='22023', message='Description must be at most 500 characters';
  end if;

  perform 1 from public.profiles profile where profile.id = v_uid for update;
  if not found then
    raise exception using errcode='42501', message='Profile unavailable';
  end if;
  if (
    select count(*)
    from public.reader_curation_lists list
    where list.owner_user_id = v_uid
  ) >= 20 then
    raise exception using errcode='22023', message='At most 20 curation lists are available during beta';
  end if;

  begin
    insert into public.reader_curation_lists (owner_user_id, title, description)
    values (v_uid, v_title, v_description)
    returning id, share_token, visibility into v_list;
  exception
    when unique_violation then
      raise exception using errcode='22023', message='A curation list with this title already exists';
  end;

  return pg_catalog.jsonb_build_object(
    'list_id', v_list.id,
    'share_token', v_list.share_token,
    'visibility', v_list.visibility
  );
end
$$;

create or replace function public.novelight_update_my_curation_list(
  p_list_id bigint,
  p_title text,
  p_description text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := coalesce(p_description, '');
  v_visibility text := coalesce(p_visibility, '');
  v_list record;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode='22023', message='Title must be 1 to 80 characters after trimming';
  end if;
  if pg_catalog.char_length(v_description) > 500 then
    raise exception using errcode='22023', message='Description must be at most 500 characters';
  end if;
  if v_visibility not in ('private', 'shared') then
    raise exception using errcode='22023', message='Visibility must be private or shared';
  end if;

  begin
    update public.reader_curation_lists list
    set title = v_title,
        description = v_description,
        visibility = v_visibility,
        updated_at = pg_catalog.now()
    where list.id = p_list_id
      and list.owner_user_id = v_uid
    returning list.id, list.share_token, list.visibility into v_list;
  exception
    when unique_violation then
      raise exception using errcode='22023', message='A curation list with this title already exists';
  end;

  if v_list.id is null then
    raise exception using errcode='42501', message='Curation list unavailable';
  end if;

  return pg_catalog.jsonb_build_object(
    'list_id', v_list.id,
    'share_token', v_list.share_token,    'visibility', v_list.visibility
  );
end
$$;

create or replace function public.novelight_add_my_curation_item(
  p_list_id bigint,
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_list_id bigint;
  v_position integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select list.id
  into v_list_id
  from public.reader_curation_lists list
  where list.id = p_list_id
    and list.owner_user_id = v_uid
  for update;

  if v_list_id is null then
    raise exception using errcode='42501', message='Curation list unavailable';
  end if;
  if not exists (
    select 1 from public.novels novel
    where novel.id = p_novel_id and novel.status = 'published'
  ) then
    raise exception using errcode='22023', message='Only currently published novels can be added';
  end if;
  if (
    select count(*) from public.reader_curation_list_items item
    where item.list_id = p_list_id
  ) >= 50 then
    raise exception using errcode='22023', message='At most 50 novels are available per curation list during beta';
  end if;

  select coalesce(max(item.position), 0) + 1
  into v_position
  from public.reader_curation_list_items item
  where item.list_id = p_list_id;

  begin
    insert into public.reader_curation_list_items (list_id, novel_id, position)
    values (p_list_id, p_novel_id, v_position);
  exception
    when unique_violation then
      raise exception using errcode='22023', message='This novel is already in the curation list';
  end;

  update public.reader_curation_lists
  set updated_at = pg_catalog.now()
  where id = p_list_id;

  return pg_catalog.jsonb_build_object(
    'list_id', p_list_id,
    'novel_id', p_novel_id,
    'position', v_position
  );
end
$$;

create or replace function public.novelight_remove_my_curation_item(
  p_list_id bigint,
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  delete from public.reader_curation_list_items item
  where item.list_id = p_list_id
    and item.novel_id = p_novel_id
    and exists (
      select 1
      from public.reader_curation_lists list
      where list.id = item.list_id
        and list.owner_user_id = v_uid
    )
  returning item.novel_id into v_deleted;

  if v_deleted is null then
    raise exception using errcode='42501', message='Curation item unavailable';
  end if;

  update public.reader_curation_lists
  set updated_at = pg_catalog.now()
  where id = p_list_id and owner_user_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'list_id', p_list_id,
    'novel_id', v_deleted,
    'status', 'removed'
  );
end
$$;

create or replace function public.novelight_rotate_my_curation_share_token(
  p_list_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token uuid;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  update public.reader_curation_lists list
  set share_token = gen_random_uuid(),
      updated_at = pg_catalog.now()
  where list.id = p_list_id
    and list.owner_user_id = v_uid
  returning list.share_token into v_token;

  if v_token is null then
    raise exception using errcode='42501', message='Curation list unavailable';
  end if;

  return pg_catalog.jsonb_build_object(
    'list_id', p_list_id,
    'share_token', v_token
  );
end
$$;

create or replace function public.novelight_delete_my_curation_list(
  p_list_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  delete from public.reader_curation_lists list
  where list.id = p_list_id
    and list.owner_user_id = v_uid
  returning list.id into v_deleted;

  if v_deleted is null then
    raise exception using errcode='42501', message='Curation list unavailable';
  end if;

  return pg_catalog.jsonb_build_object(
    'list_id', v_deleted,
    'status', 'deleted'
  );
end
$$;

create or replace function public.novelight_public_reader_curation(
  p_share_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list record;
  v_items jsonb := '[]'::jsonb;
begin
  select
    list.id,
    list.title,
    list.description,
    list.updated_at,
    profile.display_name
  into v_list
  from public.reader_curation_lists list
  join public.profiles profile on profile.id = list.owner_user_id
  where list.share_token = p_share_token
    and list.visibility = 'shared'
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'novel_id', novel.id,
        'title', novel.title,
        'genre', novel.genre,
        'description', novel.description,
        'content_rating', novel.content_rating,
        'position', item.position
      )
      order by item.position, item.added_at, item.novel_id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.reader_curation_list_items item
  join public.novels novel
    on novel.id = item.novel_id
   and novel.status = 'published'
  where item.list_id = v_list.id;

  return pg_catalog.jsonb_build_object(
    'title', v_list.title,
    'description', v_list.description,
    'curator_display_name', coalesce(v_list.display_name, '名前未設定'),
    'updated_at', v_list.updated_at,
    'items', v_items
  );
end
$$;

revoke all on function public.novelight_manage_my_curation_lists()
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_create_my_curation_list(text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_update_my_curation_list(bigint,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_add_my_curation_item(bigint,bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_remove_my_curation_item(bigint,bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_rotate_my_curation_share_token(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_delete_my_curation_list(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_public_reader_curation(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_manage_my_curation_lists()
  to authenticated;
grant execute on function public.novelight_create_my_curation_list(text,text)
  to authenticated;
grant execute on function public.novelight_update_my_curation_list(bigint,text,text,text)
  to authenticated;
grant execute on function public.novelight_add_my_curation_item(bigint,bigint)
  to authenticated;grant execute on function public.novelight_remove_my_curation_item(bigint,bigint)
  to authenticated;
grant execute on function public.novelight_rotate_my_curation_share_token(bigint)
  to authenticated;
grant execute on function public.novelight_delete_my_curation_list(bigint)
  to authenticated;
grant execute on function public.novelight_public_reader_curation(uuid)
  to anon, authenticated;

comment on table public.reader_curation_lists is
  'B #21 reader curation lists. Shared lists are link-only during beta and never rank or expose works.';
comment on table public.reader_curation_list_items is
  'B #21 list membership only. Membership is not an evaluation, favorite, Rank, LIGHT SEED, SCOUT, or exposure signal.';
comment on function public.novelight_public_reader_curation(uuid) is
  'Returns one share-token-bound curation list with currently published novels only. No public directory or popularity signal exists.';

commit;
