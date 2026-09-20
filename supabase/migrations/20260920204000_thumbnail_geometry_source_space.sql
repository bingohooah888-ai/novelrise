-- Unify Geometry Thumbnail Engine around one canonical coordinate space.
-- cover_quad is stored on the base_book source image; renderers resolve it
-- through the same contain transform used to draw the base_book.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920204000:thumbnail-geometry-source-space'));

alter table public.novel_thumbnail_templates
  add column if not exists cover_quad_space text not null default 'canvas',
  add column if not exists base_book_source_width integer,
  add column if not exists base_book_source_height integer;

alter table public.novel_thumbnail_templates
  drop constraint if exists novel_thumbnail_templates_cover_quad_space_check,
  add constraint novel_thumbnail_templates_cover_quad_space_check check (
    cover_quad_space in ('canvas', 'base_book_source')
  ),
  drop constraint if exists novel_thumbnail_templates_base_book_source_geometry_check,
  add constraint novel_thumbnail_templates_base_book_source_geometry_check check (
    (cover_quad_space = 'canvas'
      and base_book_source_width is null
      and base_book_source_height is null)
    or
    (cover_quad_space = 'base_book_source'
      and base_book_source_width > 0
      and base_book_source_height > 0)
  );
alter table public.novel_thumbnail_templates
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
      and coalesce(
        public.novelight_geometry_quad_valid(
          case when cover_quad_space = 'base_book_source' then base_book_source_width else canvas_width end,
          case when cover_quad_space = 'base_book_source' then base_book_source_height else canvas_height end,
          cover_top_left_x,
          cover_top_left_y,
          cover_top_right_x,
          cover_top_right_y,
          cover_bottom_right_x,
          cover_bottom_right_y,
          cover_bottom_left_x,
          cover_bottom_left_y
        ),
        false
      )
      and (
        (
          cover_mask_revision is null
          and cover_mask_storage_path is null
          and cover_mask_url is null
        )
        or
        (
          cover_mask_revision is not null
          and cover_mask_storage_path =
            'generated-masks/' || template_key || '/' || cover_mask_revision::text || '/' ||
            template_key || '-cover-mask.png'
          and cover_mask_url like 'https://%'
        )
      )
    )
  );

-- book-v1 source PNGs are all 1024x1536. The canonical quad below is measured
-- on that source image, not on the 1086x1448 composition canvas.
update public.novel_thumbnail_templates
   set cover_mask_source = 'cover_quad',
       cover_quad_space = 'base_book_source',
       base_book_source_width = 1024,
       base_book_source_height = 1536,
       cover_top_left_x = 164,
       cover_top_left_y = 360,
       cover_top_right_x = 714,
       cover_top_right_y = 252,
       cover_bottom_right_x = 984,
       cover_bottom_right_y = 1003,
       cover_bottom_left_x = 319,
       cover_bottom_left_y = 1156,
       cover_mask_revision = null,
       cover_mask_storage_path = null,
       cover_mask_url = null,
       updated_at = now()
 where template_key = 'book-v1';

-- Geometry changed, so every derived thumbnail cache for this template is stale.
update public.novel_thumbnail_compositions
   set revision = gen_random_uuid(),
       render_storage_path = null,
       render_url = null,
       updated_at = now()
 where template_key = 'book-v1';

update public.novels n
   set thumbnail_url = null
  from public.novel_thumbnail_compositions c
 where n.id = c.novel_id
   and c.template_key = 'book-v1'
   and n.thumbnail_asset_id is null;
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
    and cover_mask_source = 'cover_quad'
    and coalesce(
      public.novelight_geometry_quad_valid(
        case when cover_quad_space = 'base_book_source' then base_book_source_width else canvas_width end,
        case when cover_quad_space = 'base_book_source' then base_book_source_height else canvas_height end,
        cover_top_left_x,
        cover_top_left_y,
        cover_top_right_x,
        cover_top_right_y,
        cover_bottom_right_x,
        cover_bottom_right_y,
        cover_bottom_left_x,
        cover_bottom_left_y
      ),
      false
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
       and t.cover_mask_source = 'cover_quad'
       and coalesce(
         public.novelight_geometry_quad_valid(
           case when t.cover_quad_space = 'base_book_source' then t.base_book_source_width else t.canvas_width end,
           case when t.cover_quad_space = 'base_book_source' then t.base_book_source_height else t.canvas_height end,
           t.cover_top_left_x,
           t.cover_top_left_y,
           t.cover_top_right_x,
           t.cover_top_right_y,
           t.cover_bottom_right_x,
           t.cover_bottom_right_y,
           t.cover_bottom_left_x,
           t.cover_bottom_left_y
         ),
         false
       )
  ) then
    raise exception using errcode = '23514', message = 'Thumbnail template geometry is not ready';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_validate_thumbnail_composition_template()
  from public;

-- v2 remains available during rolling deploy. v3 adds the canonical coordinate
-- space and source dimensions required by the common resolved-geometry path.
create or replace function public.novelight_thumbnail_compositions_v3(
  p_novel_ids bigint[]
)
returns table (
  novel_id bigint,
  template_key text,
  canvas_width integer,
  canvas_height integer,
  cover_quad_space text,
  base_book_source_width integer,
  base_book_source_height integer,
  cover_top_left_x integer,
  cover_top_left_y integer,
  cover_top_right_x integer,
  cover_top_right_y integer,
  cover_bottom_right_x integer,
  cover_bottom_right_y integer,
  cover_bottom_left_x integer,
  cover_bottom_left_y integer,
  effect_allow_outside_cover boolean,
  background_url text,
  base_book_url text,
  cover_url text,
  pattern_url text,
  symbol_url text,
  frame_url text,
  effect_url text,
  revision uuid,
  render_url text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if p_novel_ids is null or cardinality(p_novel_ids) = 0 then
    return;
  end if;
  if cardinality(p_novel_ids) > 100 then
    raise exception using errcode = '22023', message = 'Too many novel ids';
  end if;
  return query
  select
    c.novel_id,
    c.template_key,
    t.canvas_width,
    t.canvas_height,
    t.cover_quad_space,
    t.base_book_source_width,
    t.base_book_source_height,
    t.cover_top_left_x,
    t.cover_top_left_y,
    t.cover_top_right_x,
    t.cover_top_right_y,
    t.cover_bottom_right_x,
    t.cover_bottom_right_y,
    t.cover_bottom_left_x,
    t.cover_bottom_left_y,
    t.effect_allow_outside_cover,
    case when bg.availability_status <> 'emergency_disabled' then bg.image_url end,
    case when book.availability_status <> 'emergency_disabled' then book.image_url end,
    case when cover.availability_status <> 'emergency_disabled' then cover.image_url end,
    case when pattern.availability_status <> 'emergency_disabled' then pattern.image_url end,
    case when symbol.availability_status <> 'emergency_disabled' then symbol.image_url end,
    case when frame.availability_status <> 'emergency_disabled' then frame.image_url end,
    case when effect.availability_status <> 'emergency_disabled' then effect.image_url end,
    c.revision,
    c.render_url
  from public.novel_thumbnail_compositions c
  join public.novels n on n.id = c.novel_id
  join public.novel_thumbnail_templates t on t.template_key = c.template_key
  join public.novel_thumbnail_assets bg on bg.id = c.background_asset_id
  join public.novel_thumbnail_assets book on book.id = c.base_book_asset_id
  join public.novel_thumbnail_assets cover on cover.id = c.cover_asset_id
  left join public.novel_thumbnail_assets pattern on pattern.id = c.pattern_asset_id
  left join public.novel_thumbnail_assets symbol on symbol.id = c.symbol_asset_id
  left join public.novel_thumbnail_assets frame on frame.id = c.frame_asset_id
  left join public.novel_thumbnail_assets effect on effect.id = c.effect_asset_id
  where c.novel_id = any(p_novel_ids)
    and (
      n.status = 'published'
      or (select auth.uid()) = n.user_id
    )
    and t.availability_status <> 'emergency_disabled'
    and t.canvas_width = 1086
    and t.canvas_height = 1448
    and t.cover_mask_source = 'cover_quad'
    and coalesce(
      public.novelight_geometry_quad_valid(
        case when t.cover_quad_space = 'base_book_source' then t.base_book_source_width else t.canvas_width end,
        case when t.cover_quad_space = 'base_book_source' then t.base_book_source_height else t.canvas_height end,
        t.cover_top_left_x,
        t.cover_top_left_y,
        t.cover_top_right_x,
        t.cover_top_right_y,
        t.cover_bottom_right_x,
        t.cover_bottom_right_y,
        t.cover_bottom_left_x,
        t.cover_bottom_left_y
      ),
      false
    );
end;
$$;

revoke all on function public.novelight_thumbnail_compositions_v3(bigint[]) from public;
grant execute on function public.novelight_thumbnail_compositions_v3(bigint[])
  to anon, authenticated;

insert into public.admin_operation_audit (
  admin_user_id,
  action,
  resource_type,
  resource_id,
  metadata
)
select
  created_by,
  'thumbnail.geometry.source_space.migrate',
  'novel_thumbnail_template',
  template_key,
  jsonb_build_object(
    'cover_quad_space', cover_quad_space,
    'base_book_source_width', base_book_source_width,
    'base_book_source_height', base_book_source_height,
    'cover_quad', jsonb_build_object(
      'top_left', jsonb_build_object('x', cover_top_left_x, 'y', cover_top_left_y),
      'top_right', jsonb_build_object('x', cover_top_right_x, 'y', cover_top_right_y),
      'bottom_right', jsonb_build_object('x', cover_bottom_right_x, 'y', cover_bottom_right_y),
      'bottom_left', jsonb_build_object('x', cover_bottom_left_x, 'y', cover_bottom_left_y)
    )
  )
from public.novel_thumbnail_templates
where template_key = 'book-v1'
  and created_by is not null;

commit;
