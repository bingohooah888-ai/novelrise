-- NOVELIGHT beta audit: enforce spoiler-safe automatic episode metadata.
--
-- Published episodes remain directly readable when a reader intentionally opens
-- them. Automatic outline/update/continuity surfaces must not prefetch future
-- titles or chapter names beyond the reader's qualified-read boundary.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919171500'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.beta_spoiler_boundary_function_state (
  migration_id text not null,
  function_signature text not null,
  definition text not null,
  applied_at timestamptz not null default now(),
  primary key (migration_id, function_signature)
);

insert into novelrise_migration_backup.beta_spoiler_boundary_function_state (
  migration_id,
  function_signature,
  definition
)
select '20260919171500', signature, pg_get_functiondef(signature::regprocedure)
from (
  values
    ('public.novelight_novel_outline(bigint)'),
    ('public.novelight_followed_author_updates(integer)')
) as required(signature)
on conflict (migration_id, function_signature) do nothing;

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
  v_reveal_through bigint := 0;
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

  if v_is_owner then
    v_reveal_through := 9223372036854775807;
  elsif v_user_id is not null then
    select coalesce(max(read_episode.episode_number), 0)
      into v_reveal_through
      from public.valid_read_events vr
      join public.episodes read_episode
        on read_episode.id::text = vr.episode_id_snapshot
       and read_episode.novel_id = p_novel_id
       and read_episode.status = 'published'
     where vr.reader_id = v_user_id
       and vr.novel_id_snapshot = p_novel_id::text;
  end if;

  return query
  select
    e.id,
    case when e.episode_number <= v_reveal_through then e.title else null end,
    e.episode_number,
    e.status,
    c.id,
    case when e.episode_number <= v_reveal_through then c.title else null end,
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
  from public, anon, authenticated;
grant execute on function public.novelight_novel_outline(bigint)
  to anon, authenticated, service_role;

create or replace function public.novelight_reader_episode_index(
  p_novel_ids text[]
)
returns table (
  novel_id text,
  episode_id text,
  episode_number bigint,
  episode_title text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_novel_ids is null
     or cardinality(p_novel_ids) < 1
     or cardinality(p_novel_ids) > 50
     or cardinality(p_novel_ids) <>
       cardinality(array(select distinct x from unnest(p_novel_ids) as x)) then
    raise exception using errcode = '22023',
      message = 'Reader episode index requires 1 to 50 unique works';
  end if;

  return query
  with requested as (
    select unnest(p_novel_ids) as novel_id
  ),
  published as (
    select
      n.id::text as novel_id,
      n.user_id as author_id,
      e.id::text as episode_id,
      e.episode_number,
      e.title
    from requested r
    join public.novels n
      on n.id::text = r.novel_id
     and n.status = 'published'
    join public.episodes e
      on e.novel_id = n.id
     and e.status = 'published'
  ),
  reveal_bounds as (
    select
      p.novel_id,
      p.author_id,
      case
        when v_uid is not null and v_uid = p.author_id then 9223372036854775807::bigint
        when v_uid is null then 0::bigint
        else coalesce(max(read_episode.episode_number), 0)::bigint
      end as reveal_through
    from (
      select distinct
        published_row.novel_id,
        published_row.author_id
      from published as published_row
    ) p
    left join public.valid_read_events vr
      on v_uid is not null
     and vr.reader_id = v_uid
     and vr.novel_id_snapshot = p.novel_id
    left join public.episodes read_episode
      on read_episode.id::text = vr.episode_id_snapshot
     and read_episode.novel_id::text = p.novel_id
     and read_episode.status = 'published'
    group by p.novel_id, p.author_id
  )
  select
    p.novel_id,
    p.episode_id,
    p.episode_number,
    case
      when p.episode_number <= b.reveal_through then p.title
      else null
    end as episode_title
  from published p
  join reveal_bounds b on b.novel_id = p.novel_id
  order by p.novel_id, p.episode_number, p.episode_id;
end
$$;

revoke all on function public.novelight_reader_episode_index(text[])
  from public, anon, authenticated;
grant execute on function public.novelight_reader_episode_index(text[])
  to anon, authenticated;

do $patch$
declare
  v_definition text;
  v_old text := $$'episode_title', ep.title$$;
  v_new text := $$'episode_title', case
            when ep.id is null then null
            when exists (
              select 1
              from public.valid_read_events vr
              join public.episodes read_episode
                on read_episode.id::text = vr.episode_id_snapshot
               and read_episode.novel_id = n.id
               and read_episode.status = 'published'
              where vr.reader_id = v_uid
                and vr.novel_id_snapshot = n.id::text
                and read_episode.episode_number >= ep.episode_number
            ) then ep.title
            else null
          end$$;
begin
  select pg_get_functiondef(
    'public.novelight_followed_author_updates(integer)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Followed-author update feed is missing';
  end if;

  -- Historical rollback/reapply verification can restore the older follow-feed
  -- definition after this migration first ran. Reapplication must therefore be
  -- safe and restore the current spoiler boundary without replacing the backup.
  if pg_catalog.strpos(v_definition, 'valid_read_events') = 0 then
    if pg_catalog.strpos(v_definition, v_old) = 0 then
      raise exception 'Followed-author update feed no longer matches audited title contract';
    end if;

    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    if pg_catalog.strpos(v_definition, 'valid_read_events') = 0 then
      raise exception 'Followed-author spoiler patch did not install read boundary';
    end if;

    execute v_definition;
  end if;
end
$patch$;

revoke all on function public.novelight_followed_author_updates(integer)
  from public, anon;
grant execute on function public.novelight_followed_author_updates(integer)
  to authenticated;

commit;
