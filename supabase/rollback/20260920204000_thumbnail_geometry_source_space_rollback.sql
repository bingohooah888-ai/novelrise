-- Roll back source-space geometry to the pre-migration canvas-space contract.
-- This preserves the official 32 base_book assets and only changes geometry metadata.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920204000:thumbnail-geometry-source-space:rollback'));

update public.novel_thumbnail_templates
   set cover_quad_space = 'canvas',
       base_book_source_width = null,
       base_book_source_height = null,
       cover_top_left_x = 220,
       cover_top_left_y = 339,
       cover_top_right_x = 730,
       cover_top_right_y = 239,
       cover_bottom_right_x = 980,
       cover_bottom_right_y = 935,
       cover_bottom_left_x = 363,
       cover_bottom_left_y = 1077,
       cover_mask_revision = null,
       cover_mask_storage_path = null,
       cover_mask_url = null,
       updated_at = now()
 where template_key = 'book-v1';

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

drop function if exists public.novelight_thumbnail_compositions_v3(bigint[]);

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
          canvas_width,
          canvas_height,
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
        canvas_width,
        canvas_height,
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
           t.canvas_width,
           t.canvas_height,
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

alter table public.novel_thumbnail_templates
  drop constraint if exists novel_thumbnail_templates_base_book_source_geometry_check,
  drop constraint if exists novel_thumbnail_templates_cover_quad_space_check,
  drop column if exists base_book_source_height,
  drop column if exists base_book_source_width,
  drop column if exists cover_quad_space;

commit;
