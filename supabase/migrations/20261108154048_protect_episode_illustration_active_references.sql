-- A saved manuscript must never reference an inactive/missing illustration.
-- The episode row lock taken by INSERT/UPDATE serializes with
-- novelight_delete_episode_illustration, which locks the episode FOR UPDATE.
-- This also protects direct PostgREST updates, draft saves and collaboration RPCs.

create or replace function public.novelight_validate_episode_illustration_refs()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id text;
  v_content text;
  v_novel_id bigint;
begin
  -- Check the final state at transaction end. Batch imports may register the
  -- episode first and insert its private illustrations later in the same txn.
  select e.content, e.novel_id
    into v_content, v_novel_id
    from public.episodes e
   where e.id = new.id;
  if not found
     or v_content is null
     or pg_catalog.strpos(pg_catalog.upper(v_content), 'NOVELIGHT_ILLUSTRATION:') = 0 then
    return new;
  end if;

  for v_id in
    select distinct pg_catalog.lower((
      pg_catalog.regexp_match(
        pg_catalog.btrim(ln.line, E' \t'),
        '^\[\[NOVELIGHT_ILLUSTRATION:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]$',
        'i'
      )
    )[1])
    from pg_catalog.regexp_split_to_table(
      pg_catalog.replace(v_content, E'\r', ''),
      E'\n'
    ) as ln(line)
  loop
    if v_id is not null and not exists (
      select 1
        from public.episode_illustrations img
       where img.id = v_id::uuid
         and img.episode_id = new.id
         and img.novel_id = v_novel_id
         and img.deleted_at is null
    ) then
      raise exception using
        errcode = '23503',
        message = 'EPISODE_ILLUSTRATION_MISSING_OR_DELETED';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.novelight_validate_episode_illustration_refs()
  from public, anon, authenticated;

drop trigger if exists novelight_validate_episode_illustration_refs
  on public.episodes;

create constraint trigger novelight_validate_episode_illustration_refs
after insert or update of content, novel_id on public.episodes
deferrable initially deferred
for each row
execute function public.novelight_validate_episode_illustration_refs();
