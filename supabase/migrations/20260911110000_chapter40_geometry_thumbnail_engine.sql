-- NOVELIGHT Chapter 40: Geometry Thumbnail Engine.
-- This migration is committed for the normal OWNER-approved release path only.
-- Do not apply from automated development agents.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260911110000'));

alter table public.novel_thumbnail_templates
  add column if not exists effect_allow_outside_cover boolean not null default false;

comment on column public.novel_thumbnail_templates.effect_allow_outside_cover is
  'Chapter 40 template-level permission. Only effect may render outside cover_quad when true.';

-- Deterministic server-side Geometry Validation for the canonical quad. The
-- browser uses the shared JS engine for the same shape rules plus Perspective
-- Transform stability checks before ADMIN save and before rendering.
create or replace function public.novelight_geometry_quad_valid(
  p_canvas_width integer,
  p_canvas_height integer,
  p_top_left_x integer,
  p_top_left_y integer,
  p_top_right_x integer,
  p_top_right_y integer,
  p_bottom_right_x integer,
  p_bottom_right_y integer,
  p_bottom_left_x integer,
  p_bottom_left_y integer
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  with geometry as (
    select
      ((p_top_right_x - p_top_left_x)::bigint * (p_bottom_right_y - p_top_right_y)::bigint
        - (p_top_right_y - p_top_left_y)::bigint * (p_bottom_right_x - p_top_right_x)::bigint) as turn_1,
      ((p_bottom_right_x - p_top_right_x)::bigint * (p_bottom_left_y - p_bottom_right_y)::bigint
        - (p_bottom_right_y - p_top_right_y)::bigint * (p_bottom_left_x - p_bottom_right_x)::bigint) as turn_2,
      ((p_bottom_left_x - p_bottom_right_x)::bigint * (p_top_left_y - p_bottom_left_y)::bigint
        - (p_bottom_left_y - p_bottom_right_y)::bigint * (p_top_left_x - p_bottom_left_x)::bigint) as turn_3,
      ((p_top_left_x - p_bottom_left_x)::bigint * (p_top_right_y - p_top_left_y)::bigint
        - (p_top_left_y - p_bottom_left_y)::bigint * (p_top_right_x - p_top_left_x)::bigint) as turn_4,
      (
        p_top_left_x::bigint * p_top_right_y::bigint
        + p_top_right_x::bigint * p_bottom_right_y::bigint
        + p_bottom_right_x::bigint * p_bottom_left_y::bigint
        + p_bottom_left_x::bigint * p_top_left_y::bigint
        - p_top_right_x::bigint * p_top_left_y::bigint
        - p_bottom_right_x::bigint * p_top_right_y::bigint
        - p_bottom_left_x::bigint * p_bottom_right_y::bigint
        - p_top_left_x::bigint * p_bottom_left_y::bigint
      ) as twice_area
  )
  select
    p_canvas_width > 0
    and p_canvas_height > 0
    and p_top_left_x between 0 and p_canvas_width
    and p_top_left_y between 0 and p_canvas_height
    and p_top_right_x between 0 and p_canvas_width
    and p_top_right_y between 0 and p_canvas_height
    and p_bottom_right_x between 0 and p_canvas_width
    and p_bottom_right_y between 0 and p_canvas_height
    and p_bottom_left_x between 0 and p_canvas_width
    and p_bottom_left_y between 0 and p_canvas_height
    and (p_top_left_x, p_top_left_y) <> (p_top_right_x, p_top_right_y)
    and (p_top_left_x, p_top_left_y) <> (p_bottom_right_x, p_bottom_right_y)
    and (p_top_left_x, p_top_left_y) <> (p_bottom_left_x, p_bottom_left_y)
    and (p_top_right_x, p_top_right_y) <> (p_bottom_right_x, p_bottom_right_y)
    and (p_top_right_x, p_top_right_y) <> (p_bottom_left_x, p_bottom_left_y)
    and (p_bottom_right_x, p_bottom_right_y) <> (p_bottom_left_x, p_bottom_left_y)
    and abs(geometry.twice_area) >= 200
    and (
      (geometry.turn_1 > 0 and geometry.turn_2 > 0 and geometry.turn_3 > 0 and geometry.turn_4 > 0)
      or
      (geometry.turn_1 < 0 and geometry.turn_2 < 0 and geometry.turn_3 < 0 and geometry.turn_4 < 0)
    )
  from geometry;
$$;

revoke all on function public.novelight_geometry_quad_valid(
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
) from public;
grant execute on function public.novelight_geometry_quad_valid(
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
) to anon, authenticated, service_role;

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

-- Reader-side cache fallback consumes the same canonical geometry rather than
-- rebuilding with the Chapter 39 PNG-mask/CSS path. A new RPC keeps rolling
-- deployment compatible: old clients can continue using v1 while Chapter 40
-- clients only opt into geometry-aware data after this migration exists.
create or replace function public.novelight_thumbnail_compositions_v2(
  p_novel_ids bigint[]
)
returns table (
  novel_id bigint,
  template_key text,
  canvas_width integer,
  canvas_height integer,
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
    );
end;
$$;

revoke all on function public.novelight_thumbnail_compositions_v2(bigint[]) from public;
grant execute on function public.novelight_thumbnail_compositions_v2(bigint[])
  to anon, authenticated;

-- Template-level effect overflow is canonical data and therefore changes the
-- rendered output. Invalidate cached WebP automatically whenever it changes.
create or replace function public.novelight_invalidate_thumbnail_effect_policy_cache()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.effect_allow_outside_cover is not distinct from old.effect_allow_outside_cover then
    return new;
  end if;

  update public.novel_thumbnail_compositions c
     set revision = gen_random_uuid(),
         render_storage_path = null,
         render_url = null,
         updated_at = now()
   where c.template_key = new.template_key;

  update public.novels n
     set thumbnail_url = null
    from public.novel_thumbnail_compositions c
   where n.id = c.novel_id
     and c.template_key = new.template_key
     and n.thumbnail_asset_id is null;

  return new;
end;
$$;

revoke all on function public.novelight_invalidate_thumbnail_effect_policy_cache()
  from public, anon, authenticated;

drop trigger if exists novelight_invalidate_thumbnail_effect_policy_cache
  on public.novel_thumbnail_templates;
create trigger novelight_invalidate_thumbnail_effect_policy_cache
after update of effect_allow_outside_cover
on public.novel_thumbnail_templates
for each row
execute function public.novelight_invalidate_thumbnail_effect_policy_cache();

-- Existing Chapter 39 admin RPC remains valid. It still writes an optional
-- derived debug mask together with the canonical quad. Rendering never consumes
-- that PNG after Chapter 40. API-side validation rejects invalid or unstable
-- Perspective Transform geometry before that RPC is called.

commit;
