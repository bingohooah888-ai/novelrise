-- NOVELIGHT: manual rollback for 20260930224500_episode_illustration_atomic_reference.sql.
-- This removes the crash-safe insert trigger and restores the immediately previous
-- public episode illustration bundle behavior. Existing body markers are retained
-- because they are valid episode content and may still reference registered assets.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260930224500:rollback'));

drop trigger if exists episode_illustration_reference_guard
  on public.episode_illustrations;

drop function if exists public.novelight_episode_illustration_reference_guard();

create or replace function public.novelight_public_episode_illustration_bundle(
  p_episode_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_episode record;
  v_assets jsonb;
begin
  select e.id, e.novel_id, e.content, n.illustration_ai_usage
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

  return pg_catalog.jsonb_build_object(
    'episode_id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'content', v_episode.content,
    'illustration_ai_usage', v_episode.illustration_ai_usage,
    'assets', v_assets
  );
end
$$;

revoke all on function public.novelight_public_episode_illustration_bundle(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_public_episode_illustration_bundle(bigint)
  to service_role;

comment on function public.novelight_public_episode_illustration_bundle(bigint) is
  'Service-only published-episode illustration metadata. Caller must filter assets to IDs referenced by current content before signing URLs.';

commit;
