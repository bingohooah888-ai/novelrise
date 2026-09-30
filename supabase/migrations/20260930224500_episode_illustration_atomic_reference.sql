-- Prevent successful illustration uploads from becoming orphaned when the
-- browser leaves before its debounced episode-body save completes.
--
-- The client still places the marker at the author's selected cursor position.
-- This database trigger only provides a crash/navigation-safe fallback marker;
-- the next normal editor save replaces the episode content with the client body
-- and therefore keeps the marker at the selected position.
--
-- Reader-facing AI disclosure is also suppressed when the current published
-- episode body does not actually reference a registered illustration.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260930224500'));

create or replace function public.novelight_episode_illustration_reference_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_marker text := '[[NOVELIGHT_ILLUSTRATION:' || new.id::text || ']]';
  v_content text;
begin
  select e.content
    into v_content
    from public.episodes e
   where e.id = new.episode_id
   for update;

  if not found then
    return new;
  end if;

  if not exists (
    select 1
      from pg_catalog.regexp_split_to_table(
        pg_catalog.replace(coalesce(v_content, ''), E'\r', ''),
        E'\n'
      ) as marker_line(line)
     where pg_catalog.btrim(marker_line.line, E' \t') = v_marker
  ) then
    update public.episodes e
       set content = case
         when coalesce(e.content, '') = '' then v_marker
         when right(e.content, 1) = E'\n' then e.content || v_marker
         else e.content || E'\n' || v_marker
       end
     where e.id = new.episode_id;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_episode_illustration_reference_guard()
  from public, anon, authenticated, service_role;

drop trigger if exists episode_illustration_reference_guard
  on public.episode_illustrations;

create trigger episode_illustration_reference_guard
after insert on public.episode_illustrations
for each row
execute function public.novelight_episode_illustration_reference_guard();

create or replace function public.novelight_public_episode_illustration_bundle(
  p_episode_id bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_episode record;
  v_assets jsonb;
  v_has_referenced_assets boolean := false;
begin
  select e.id,
         e.novel_id,
         e.content,
         n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'storage_path', i.storage_path,
        'width', i.width,
        'height', i.height,
        'alt_text', i.alt_text
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
    into v_assets
    from public.episode_illustrations i
   where i.episode_id = p_episode_id;

  select exists (
    select 1
      from public.episode_illustrations i
     where i.episode_id = p_episode_id
       and exists (
         select 1
           from pg_catalog.regexp_split_to_table(
             pg_catalog.replace(coalesce(v_episode.content, ''), E'\r', ''),
             E'\n'
           ) as marker_line(line)
          where pg_catalog.btrim(marker_line.line, E' \t') =
                '[[NOVELIGHT_ILLUSTRATION:' || i.id::text || ']]'
       )
  ) into v_has_referenced_assets;

  return pg_catalog.jsonb_build_object(
    'episode_id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'content', v_episode.content,
    'illustration_ai_usage',
      (v_episode.illustration_ai_usage is true and v_has_referenced_assets),
    'assets', v_assets
  );
end
$$;

comment on function public.novelight_episode_illustration_reference_guard() is
  'Crash-safe fallback: a registered episode illustration always leaves a recoverable body marker even if the browser exits before its body save.';

comment on function public.novelight_public_episode_illustration_bundle(bigint) is
  'Service-only published-episode illustration metadata. AI disclosure is true only when the current episode body actually references at least one registered illustration.';

commit;
