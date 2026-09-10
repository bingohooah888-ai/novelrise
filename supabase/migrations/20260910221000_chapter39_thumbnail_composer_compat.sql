-- Chapter 39 compatibility/hardening follow-up.
-- Preserve the legacy admin registration RPC during rolling deployment and
-- normalize the cached-render path validation.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910221000'));

alter table public.novel_thumbnail_assets
  alter column layer_type set default 'legacy_complete',
  alter column template_key set default 'legacy-complete-v1';

alter table public.novel_thumbnail_compositions
  drop constraint if exists novel_thumbnail_compositions_render_pair_check,
  add constraint novel_thumbnail_compositions_render_pair_check check (
    (render_storage_path is null and render_url is null)
    or
    (
      render_storage_path ~ '^renders/[0-9]+/[0-9a-f-]{36}\.webp$'
      and render_url like 'https://%'
    )
  );

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
     or p_storage_path !~ '^renders/[0-9]+/[0-9a-f-]{36}\.webp$'
     or p_render_url not like 'https://%'
  then
    raise exception using errcode = '22023', message = 'Invalid thumbnail render metadata';
  end if;

  update public.novel_thumbnail_compositions
     set render_storage_path = p_storage_path,
         render_url = p_render_url,
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

  return found;
end;
$$;

revoke all on function public.novelight_attach_thumbnail_render(
  bigint, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.novelight_attach_thumbnail_render(
  bigint, uuid, text, text
) to service_role;

commit;
