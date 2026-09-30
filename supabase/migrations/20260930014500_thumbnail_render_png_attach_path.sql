-- Keep the thumbnail attach RPC aligned with the render API and Storage bucket.
-- Safari/WebKit can produce PNG when canvas WebP encoding falls back, so both
-- verified WebP and PNG render paths must be accepted at the final attach step.
create or replace function public.novelight_attach_thumbnail_render(
  p_novel_id bigint,
  p_revision uuid,
  p_storage_path text,
  p_render_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_novel_id is null
     or p_revision is null
     or p_storage_path !~ '^renders/[0-9]+/[0-9a-f-]{36}[.](webp|png)$'
     or p_render_url not like 'https://%'
  then
    raise exception using errcode = '22023', message = 'Invalid thumbnail render metadata';
  end if;

  update public.novel_thumbnail_compositions
     set render_storage_path = p_storage_path,
         render_url = p_render_url,
         rendered_at = now(),
         updated_at = now()
   where novel_id = p_novel_id
     and revision = p_revision;

  if not found then
    return false;
  end if;

  update public.novels
     set thumbnail_asset_id = null,
         thumbnail_url = p_render_url
   where id = p_novel_id;

  update public.thumbnail_render_failures
     set resolved_at = now()
   where novel_id = p_novel_id
     and resolved_at is null;

  return true;
end;
$$;
