-- NOVELIGHT beta: safe server-side episode drafts and bulk migration support.
--
-- This migration does not scrape or fetch content from third-party services.
-- Authors explicitly provide the text they own and import it as private drafts.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916001000'));

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on novels and episodes';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_insert_owner'
      and cmd = 'INSERT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_update_owner'
      and cmd = 'UPDATE'
  ) then
    raise exception 'Required episode owner write policies are missing';
  end if;

  if to_regprocedure('public.novelight_save_episode_draft(bigint,bigint,bigint,text,text)') is not null
     or to_regprocedure('public.novelight_publish_episode_draft_atomic(bigint)') is not null
     or to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is not null then
    raise exception 'Beta draft/import RPC already exists; stop and inspect before applying';
  end if;
end
$$;

create function public.novelight_save_episode_draft(
  p_novel_id bigint,
  p_episode_id bigint,
  p_episode_number bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_episode_id bigint;
  v_title text := coalesce(p_title, '');
  v_content text := coalesce(p_content, '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_novel_id is null or p_episode_number is null or p_episode_number < 1 then
    raise exception 'A valid novel and episode number are required' using errcode = '22023';
  end if;
  if char_length(v_title) > 150 then
    raise exception 'Episode title must be at most 150 characters' using errcode = '22023';
  end if;
  if char_length(v_content) > 100000 then
    raise exception 'Episode content must be at most 100000 characters' using errcode = '22023';
  end if;

  perform 1
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id;
  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  if p_episode_id is null then
    insert into public.episodes (
      novel_id,
      user_id,
      episode_number,
      title,
      content,
      status,
      pv
    ) values (
      p_novel_id,
      v_user_id,
      p_episode_number,
      v_title,
      v_content,
      'draft',
      0
    )
    returning id into v_episode_id;
  else
    update public.episodes e
    set episode_number = p_episode_number,
        title = v_title,
        content = v_content
    where e.id = p_episode_id
      and e.novel_id = p_novel_id
      and e.user_id = v_user_id
      and e.status = 'draft'
    returning e.id into v_episode_id;

    if v_episode_id is null then
      raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
    end if;
  end if;

  return v_episode_id;
end
$$;

create function public.novelight_publish_episode_draft_atomic(
  p_episode_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.novel_id,
         e.episode_number,
         e.status,
         e.title,
         e.content,
         n.status
  into v_novel_id,
       v_episode_number,
       v_episode_status,
       v_title,
       v_content,
       v_novel_status
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id
    and e.user_id = v_user_id
    and n.user_id = v_user_id
  for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;
  if v_episode_status <> 'draft' then
    raise exception 'Only draft episodes can be published by this RPC' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before publication' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first published episode must be episode 1' using errcode = '22023';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
    set status = 'published'
    where id = v_novel_id
      and user_id = v_user_id;
    if not found then
      raise exception 'Novel could not be published by current user' using errcode = '42501';
    end if;
  end if;

  update public.episodes
  set status = 'published'
  where id = p_episode_id
    and user_id = v_user_id
    and status = 'draft';
  if not found then
    raise exception 'Draft episode publication raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

create function public.novelight_import_episode_drafts(
  p_novel_id bigint,
  p_items jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_episode_number bigint;
  v_title text;
  v_content text;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Import items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'Import must contain between 1 and 200 episodes' using errcode = '22023';
  end if;

  perform 1
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each import item must be an object' using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'episode_number', '') !~ '^[0-9]+$' then
      raise exception 'Each episode_number must be a positive integer' using errcode = '22023';
    end if;
    v_episode_number := (v_item ->> 'episode_number')::bigint;
    v_title := coalesce(v_item ->> 'title', '');
    v_content := coalesce(v_item ->> 'content', '');
    if v_episode_number < 1 then
      raise exception 'Each episode_number must be at least 1' using errcode = '22023';
    end if;
    if char_length(trim(v_title)) < 1 or char_length(v_title) > 150 then
      raise exception 'Each imported title must contain 1 to 150 characters' using errcode = '22023';
    end if;
    if char_length(trim(v_content)) < 1 or char_length(v_content) > 100000 then
      raise exception 'Each imported body must contain 1 to 100000 characters' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by (item ->> 'episode_number')::bigint
    having count(*) > 1
  ) then
    raise exception 'Import contains duplicate episode numbers' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.episodes e
    join jsonb_array_elements(p_items) item
      on e.episode_number = (item ->> 'episode_number')::bigint
    where e.novel_id = p_novel_id
  ) then
    raise exception 'One or more imported episode numbers already exist in this novel' using errcode = '23505';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.episodes (
      novel_id,
      user_id,
      episode_number,
      title,
      content,
      status,
      pv
    ) values (
      p_novel_id,
      v_user_id,
      (v_item ->> 'episode_number')::bigint,
      v_item ->> 'title',
      v_item ->> 'content',
      'draft',
      0
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

revoke all on function public.novelight_save_episode_draft(bigint,bigint,bigint,text,text) from public;
revoke all on function public.novelight_save_episode_draft(bigint,bigint,bigint,text,text) from anon;
grant execute on function public.novelight_save_episode_draft(bigint,bigint,bigint,text,text) to authenticated;

revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from public;
revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from anon;
grant execute on function public.novelight_publish_episode_draft_atomic(bigint) to authenticated;

revoke all on function public.novelight_import_episode_drafts(bigint,jsonb) from public;
revoke all on function public.novelight_import_episode_drafts(bigint,jsonb) from anon;
grant execute on function public.novelight_import_episode_drafts(bigint,jsonb) to authenticated;

commit;
