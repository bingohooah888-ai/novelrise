-- NOVELIGHT Chapter 40: Geometry Thumbnail Engine.
-- This migration is committed for the normal OWNER-approved release path only.
-- Do not apply from automated development agents.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260911110000'));

alter table public.novel_thumbnail_templates
  add column if not exists effect_allow_outside_cover boolean not null default false;

comment on column public.novel_thumbnail_templates.effect_allow_outside_cover is
  'Chapter 40 template-level permission. Only effect may render outside cover_quad when true.';

-- base_book + cover_quad are the rendering source of truth. A generated PNG mask
-- may exist for debugging, but the renderer must not depend on it.
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

-- Every author-visible official template must be geometry-backed. There is no
-- book-v1-only exception and no PNG-mask readiness requirement.
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
    and cover_top_left_x is not null
    and cover_top_left_y is not null
    and cover_top_right_x is not null
    and cover_top_right_y is not null
    and cover_bottom_right_x is not null
    and cover_bottom_right_y is not null
    and cover_bottom_left_x is not null
    and cover_bottom_left_y is not null
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
       and t.cover_top_left_x is not null
       and t.cover_top_left_y is not null
       and t.cover_top_right_x is not null
       and t.cover_top_right_y is not null
       and t.cover_bottom_right_x is not null
       and t.cover_bottom_right_y is not null
       and t.cover_bottom_left_x is not null
       and t.cover_bottom_left_y is not null
  ) then
    raise exception using errcode = '23514', message = 'Thumbnail template geometry is not ready';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_validate_thumbnail_composition_template()
  from public;

-- Existing Chapter 39 admin RPC remains valid. It still writes an optional
-- derived debug mask together with the canonical quad. Rendering never consumes
-- that PNG after Chapter 40.

commit;
