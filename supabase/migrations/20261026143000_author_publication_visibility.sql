-- Reversible author visibility controls. Preserve IDs, content, metrics and first publication times.
-- Never apply independently of the matching author UI and reader-privacy checks.
begin;

create or replace function public.novelight_set_novel_publication(
  p_novel_id bigint, p_publish boolean
) returns jsonb
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_published_count integer;
  v_draft_count integer;
  v_target_status text;
begin
  if v_uid is null or p_novel_id is null or p_publish is null then
    raise exception 'Authentication and explicit target state required' using errcode='42501';
  end if;

  select n.status into v_status
  from public.novels n
  where n.id=p_novel_id and n.user_id=v_uid
  for update;
  if not found then
    raise exception 'Novel not found or not owned' using errcode='42501';
  end if;

  select count(*) filter (where e.status='published'),
         count(*) filter (where e.status='draft')
  into v_published_count,v_draft_count
  from public.episodes e
  where e.novel_id=p_novel_id and e.user_id=v_uid;

  if p_publish and v_published_count=0 then
    raise exception 'Publish the first episode before publishing this novel' using errcode='22023';
  end if;

  if not p_publish then
    -- A scheduled draft must not silently reactivate an unpublished novel.
    update public.episodes e set scheduled_publish_at=null
    where e.novel_id=p_novel_id and e.user_id=v_uid
      and e.status='draft' and e.scheduled_publish_at is not null;
  end if;

  v_target_status := case when p_publish then 'published' else 'draft' end;
  if v_status is distinct from v_target_status then
    update public.novels set status=v_target_status
    where id=p_novel_id and user_id=v_uid;
  end if;

  return pg_catalog.jsonb_build_object(
    'status',case when p_publish then 'published' else 'draft' end,
    'published_count',v_published_count,'draft_count',v_draft_count
  );
end;
$fn$;

create or replace function public.novelight_set_episode_publication(
  p_episode_id bigint, p_publish boolean
) returns jsonb
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
  v_novel_status text;
  v_episode_status text;
  v_number bigint;
  v_title text;
  v_content text;
  v_published_count integer;
begin
  if v_uid is null or p_episode_id is null or p_publish is null then
    raise exception 'Authentication and explicit target state required' using errcode='42501';
  end if;

  -- Parent row is locked first to serialize all author publication transitions.
  select e.novel_id into v_novel_id
  from public.episodes e where e.id=p_episode_id and e.user_id=v_uid;
  if not found then raise exception 'Episode not owned or not found' using errcode='42501'; end if;

  select n.status into v_novel_status
  from public.novels n where n.id=v_novel_id and n.user_id=v_uid for update;
  if not found then raise exception 'Parent novel not owned' using errcode='42501'; end if;

  select e.status,e.episode_number,e.title,e.content
  into v_episode_status,v_number,v_title,v_content
  from public.episodes e
  where e.id=p_episode_id and e.novel_id=v_novel_id and e.user_id=v_uid
  for update;
  if not found then raise exception 'Episode no longer found' using errcode='40001'; end if;

  if p_publish then
    if length(trim(coalesce(v_title,''))) not between 1 and 150
      or length(trim(coalesce(v_content,'')))<1
      or length(coalesce(v_content,''))>100000 then
      raise exception 'Complete title and body required before publication' using errcode='22023';
    end if;

    select count(*) into v_published_count from public.episodes e
    where e.novel_id=v_novel_id and e.status='published';
    if v_novel_status<>'published' and v_number<>1 and v_published_count=0 then
      raise exception 'Publish episode 1 before later episodes' using errcode='22023';
    end if;

    if v_novel_status<>'published' then
      update public.novels set status='published'
      where id=v_novel_id and user_id=v_uid;
    end if;

    if v_episode_status<>'published' then
      update public.episodes set status='published',scheduled_publish_at=null
      where id=p_episode_id and user_id=v_uid;
    end if;
  else
    -- Unpublishing must never delete content or reset first_published_at/PV.
    if v_episode_status='published' then
      update public.episodes set status='draft',scheduled_publish_at=null
      where id=p_episode_id and user_id=v_uid;
    elsif v_episode_status='draft' then
      update public.episodes set scheduled_publish_at=null
      where id=p_episode_id and user_id=v_uid and scheduled_publish_at is not null;
    end if;
    if not exists (select 1 from public.episodes e
                   where e.novel_id=v_novel_id and e.status='published') then
      update public.novels set status='draft'
      where id=v_novel_id and user_id=v_uid and status='published';
    end if;
  end if;

  select count(*) into v_published_count from public.episodes e
  where e.novel_id=v_novel_id and e.status='published';

  return pg_catalog.jsonb_build_object(
    'novel_id',v_novel_id,
    'episode_status',case when p_publish then 'published' else 'draft' end,
    'novel_status',case when p_publish then 'published' when v_published_count=0 then 'draft' else v_novel_status end,
    'published_count',v_published_count
  );
end;
$fn$;

revoke all on function public.novelight_set_novel_publication(bigint,boolean) from public,anon,authenticated;
revoke all on function public.novelight_set_episode_publication(bigint,boolean) from public,anon,authenticated;
grant execute on function public.novelight_set_novel_publication(bigint,boolean) to authenticated;
grant execute on function public.novelight_set_episode_publication(bigint,boolean) to authenticated;
-- Status counts are owner-scoped by both explicit ownership and invoker RLS.
create or replace function public.novelight_author_novel_episode_counts()
returns table(novel_id bigint, published_count bigint, draft_count bigint, scheduled_count bigint)
language sql stable security invoker set search_path=''
as $counts$
  select e.novel_id,
         count(*) filter (where e.status='published')::bigint,
         count(*) filter (where e.status='draft')::bigint,
         count(*) filter (where e.status='draft' and e.scheduled_publish_at is not null)::bigint
  from public.episodes e
  join public.novels n on n.id=e.novel_id
  where n.user_id=(select auth.uid()) and e.user_id=(select auth.uid())
  group by e.novel_id;
$counts$;

revoke all on function public.novelight_author_novel_episode_counts() from public,anon,authenticated;
grant execute on function public.novelight_author_novel_episode_counts() to authenticated;

commit;
