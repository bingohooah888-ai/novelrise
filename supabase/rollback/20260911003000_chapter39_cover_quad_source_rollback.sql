-- Rollback for Chapter 39 cover-quad source-of-truth follow-up.
-- Refuse rollback after any template has adopted quad-backed geometry because
-- dropping those columns would discard the canonical source used to build masks.

begin;

select pg_advisory_xact_lock(hashtext('novelight:rollback:20260911003000'));

do $$
begin
  if exists (
    select 1
      from public.novel_thumbnail_templates
     where cover_mask_source = 'cover_quad'
  ) then
    raise exception 'rollback refused: quad-backed thumbnail templates exist';
  end if;
end
$$;

drop trigger if exists novelight_guard_quad_backed_cover_mask_asset
  on public.novel_thumbnail_assets;
drop function if exists public.novelight_guard_quad_backed_cover_mask_asset();

drop function if exists public.novelight_admin_set_thumbnail_template_cover_quad(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, integer,
  uuid, text, text
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
  ) then
    raise exception using errcode = '23514', message = 'Thumbnail template is not composition-ready';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_validate_thumbnail_composition_template()
  from public;

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
  );

alter table public.novel_thumbnail_templates
  drop constraint if exists novel_thumbnail_templates_cover_quad_check,
  drop constraint if exists novel_thumbnail_templates_cover_mask_source_check,
  drop column if exists cover_mask_revision,
  drop column if exists cover_mask_source,
  drop column if exists cover_bottom_left_y,
  drop column if exists cover_bottom_left_x,
  drop column if exists cover_bottom_right_y,
  drop column if exists cover_bottom_right_x,
  drop column if exists cover_top_right_y,
  drop column if exists cover_top_right_x,
  drop column if exists cover_top_left_y,
  drop column if exists cover_top_left_x;

commit;
