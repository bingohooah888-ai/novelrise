-- NOVELIGHT Chapter 39 follow-up: make cover quadrilateral coordinates the
-- source of truth for book-v1 and treat the PNG cover mask as a derived asset.
-- Production application requires the normal OWNER-approved migration path.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260911003000'));

alter table public.novel_thumbnail_templates
  add column if not exists cover_top_left_x integer,
  add column if not exists cover_top_left_y integer,
  add column if not exists cover_top_right_x integer,
  add column if not exists cover_top_right_y integer,
  add column if not exists cover_bottom_right_x integer,
  add column if not exists cover_bottom_right_y integer,
  add column if not exists cover_bottom_left_x integer,
  add column if not exists cover_bottom_left_y integer,
  add column if not exists cover_mask_source text not null default 'legacy_asset',
  add column if not exists cover_mask_revision uuid;

alter table public.novel_thumbnail_templates
  drop constraint if exists novel_thumbnail_templates_cover_mask_source_check,
  add constraint novel_thumbnail_templates_cover_mask_source_check check (
    cover_mask_source in ('legacy_asset', 'cover_quad')
  ),
  drop constraint if exists novel_thumbnail_templates_cover_quad_check,
  add constraint novel_thumbnail_templates_cover_quad_check check (
    (
      cover_mask_source = 'legacy_asset'
      and cover_top_left_x is null
      and cover_top_left_y is null
      and cover_top_right_x is null
      and cover_top_right_y is null
      and cover_bottom_right_x is null
      and cover_bottom_right_y is null
      and cover_bottom_left_x is null
      and cover_bottom_left_y is null
      and cover_mask_revision is null
    )
    or
    (
      cover_mask_source = 'cover_quad'
      and cover_top_left_x between 0 and canvas_width
      and cover_top_left_y between 0 and canvas_height
      and cover_top_right_x between 0 and canvas_width
      and cover_top_right_y between 0 and canvas_height
      and cover_bottom_right_x between 0 and canvas_width
      and cover_bottom_right_y between 0 and canvas_height
      and cover_bottom_left_x between 0 and canvas_width
      and cover_bottom_left_y between 0 and canvas_height
      and cover_top_left_x < cover_top_right_x
      and cover_bottom_left_x < cover_bottom_right_x
      and cover_top_left_y < cover_bottom_left_y
      and cover_top_right_y < cover_bottom_right_y
      and cover_mask_revision is not null
      and cover_mask_storage_path is not null
      and cover_mask_url is not null
      and cover_mask_storage_path =
        'generated-masks/' || template_key || '/' || cover_mask_revision::text || '/' ||
        template_key || '-cover-mask.png'
    )
  );

-- book-v1 is not author-visible until its four-point source geometry and the
-- PNG derived from that geometry both exist. Other future templates retain the
-- Chapter 39 legacy-mask compatibility path until they are migrated separately.
drop policy if exists "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates;
create policy "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates
  for select
  to anon, authenticated
  using (
    availability_status = 'active'
    and canvas_width = 1086
    and canvas_height = 1448
    and cover_mask_url is not null
    and (
      template_key <> 'book-v1'
      or cover_mask_source = 'cover_quad'
    )
  );

create or replace function public.novelight_validate_thumbnail_composition_template()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
      from public.novel_thumbnail_templates t
     where t.template_key = new.template_key
       and t.availability_status = 'active'
       and t.canvas_width = 1086
       and t.canvas_height = 1448
       and t.cover_mask_url is not null
       and (
         t.template_key <> 'book-v1'
         or t.cover_mask_source = 'cover_quad'
       )
  ) then
    raise exception using errcode = '23514', message = 'Thumbnail template is not composition-ready';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_validate_thumbnail_composition_template()
  from public;

create or replace function public.novelight_admin_set_thumbnail_template_cover_quad(
  p_admin_user_id uuid,
  p_template_key text,
  p_top_left_x integer,
  p_top_left_y integer,
  p_top_right_x integer,
  p_top_right_y integer,
  p_bottom_right_x integer,
  p_bottom_right_y integer,
  p_bottom_left_x integer,
  p_bottom_left_y integer,
  p_mask_revision uuid,
  p_mask_storage_path text,
  p_mask_url text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_template text := trim(coalesce(p_template_key, ''));
  v_expected_path text;
  v_row public.novel_thumbnail_templates%rowtype;
begin
  if p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'Admin identity is required';
  end if;
  if v_template !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Thumbnail template key is invalid';
  end if;
  if p_mask_revision is null then
    raise exception using errcode = '22023', message = 'Mask revision is required';
  end if;

  v_expected_path := 'generated-masks/' || v_template || '/' || p_mask_revision::text || '/' ||
    v_template || '-cover-mask.png';
  if coalesce(p_mask_storage_path, '') <> v_expected_path
     or coalesce(p_mask_url, '') not like 'https://%' then
    raise exception using errcode = '22023', message = 'Derived cover mask location is invalid';
  end if;

  select *
    into v_row
    from public.novel_thumbnail_templates
   where template_key = v_template
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Thumbnail template not found';
  end if;
  if v_row.canvas_width <> 1086 or v_row.canvas_height <> 1448 then
    raise exception using errcode = '23514', message = 'Thumbnail template canvas is invalid';
  end if;

  update public.novel_thumbnail_templates
     set cover_top_left_x = p_top_left_x,
         cover_top_left_y = p_top_left_y,
         cover_top_right_x = p_top_right_x,
         cover_top_right_y = p_top_right_y,
         cover_bottom_right_x = p_bottom_right_x,
         cover_bottom_right_y = p_bottom_right_y,
         cover_bottom_left_x = p_bottom_left_x,
         cover_bottom_left_y = p_bottom_left_y,
         cover_mask_source = 'cover_quad',
         cover_mask_revision = p_mask_revision,
         cover_mask_storage_path = p_mask_storage_path,
         cover_mask_url = p_mask_url,
         updated_at = now()
   where template_key = v_template
   returning * into v_row;

  -- A geometry change changes the canonical composition. Any previously cached
  -- WebP is therefore stale even when the seven selected layer IDs are unchanged.
  update public.novel_thumbnail_compositions c
     set revision = gen_random_uuid(),
         render_storage_path = null,
         render_url = null,
         updated_at = now()
   where c.template_key = v_template;

  update public.novels n
     set thumbnail_url = null
    from public.novel_thumbnail_compositions c
   where n.id = c.novel_id
     and c.template_key = v_template
     and n.thumbnail_asset_id is null;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'thumbnail.template.cover_quad.update',
    'novel_thumbnail_template',
    v_template,
    jsonb_build_object(
      'cover_quad', jsonb_build_object(
        'top_left', jsonb_build_object('x', p_top_left_x, 'y', p_top_left_y),
        'top_right', jsonb_build_object('x', p_top_right_x, 'y', p_top_right_y),
        'bottom_right', jsonb_build_object('x', p_bottom_right_x, 'y', p_bottom_right_y),
        'bottom_left', jsonb_build_object('x', p_bottom_left_x, 'y', p_bottom_left_y)
      ),
      'mask_revision', p_mask_revision,
      'mask_storage_path', p_mask_storage_path
    )
  );

  return jsonb_build_object(
    'template_key', v_row.template_key,
    'cover_mask_source', v_row.cover_mask_source,
    'cover_mask_revision', v_row.cover_mask_revision,
    'cover_mask_storage_path', v_row.cover_mask_storage_path,
    'cover_mask_url', v_row.cover_mask_url,
    'cover_top_left_x', v_row.cover_top_left_x,
    'cover_top_left_y', v_row.cover_top_left_y,
    'cover_top_right_x', v_row.cover_top_right_x,
    'cover_top_right_y', v_row.cover_top_right_y,
    'cover_bottom_right_x', v_row.cover_bottom_right_x,
    'cover_bottom_right_y', v_row.cover_bottom_right_y,
    'cover_bottom_left_x', v_row.cover_bottom_left_x,
    'cover_bottom_left_y', v_row.cover_bottom_left_y,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.novelight_admin_set_thumbnail_template_cover_quad(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, integer,
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_set_thumbnail_template_cover_quad(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, integer,
  uuid, text, text
) to service_role;

-- Once a template is quad-backed, old manually uploaded cover-mask assets may
-- remain for audit/history but cannot be toggled to overwrite the canonical mask.
create or replace function public.novelight_guard_quad_backed_cover_mask_asset()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.layer_type = 'cover_mask'
     and exists (
       select 1
         from public.novel_thumbnail_templates t
        where t.template_key = old.template_key
          and t.cover_mask_source = 'cover_quad'
     ) then
    raise exception using errcode = '23514', message = 'Quad-backed cover mask assets are read-only';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_guard_quad_backed_cover_mask_asset()
  from public;

drop trigger if exists novelight_guard_quad_backed_cover_mask_asset
  on public.novel_thumbnail_assets;
create trigger novelight_guard_quad_backed_cover_mask_asset
before update of availability_status, is_active
on public.novel_thumbnail_assets
for each row
when (old.layer_type = 'cover_mask')
execute function public.novelight_guard_quad_backed_cover_mask_asset();

commit;
