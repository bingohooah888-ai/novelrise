-- Roll back Chapter 40 template policy only when all geometry-backed templates
-- still have the Chapter 39 derived mask needed by the old renderer.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260911110000:rollback'));
do $$
begin
  if exists (
    select 1
      from public.novel_thumbnail_templates
     where effect_allow_outside_cover is true
  ) then
    raise exception 'rollback refused: Chapter 40 effect outside-cover policy is in use';
  end if;

  if exists (
    select 1
      from public.novel_thumbnail_templates
     where cover_mask_source = 'cover_quad'
       and (
         cover_mask_revision is null
         or cover_mask_storage_path is null
         or cover_mask_url is null
       )
  ) then
    raise exception 'rollback refused: geometry-backed template has no Chapter 39 debug mask';
  end if;
end
$$;

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

drop function if exists public.novelight_thumbnail_compositions_v2(bigint[]);

alter table public.novel_thumbnail_templates
  drop column if exists effect_allow_outside_cover;

drop function if exists public.novelight_geometry_quad_valid(
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
);

commit;
