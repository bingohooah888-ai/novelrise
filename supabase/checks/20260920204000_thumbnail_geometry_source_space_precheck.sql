-- Precheck for canonical base_book source-space geometry migration.

do $$
declare
  v_active_count integer;
begin
  if to_regclass('public.novel_thumbnail_templates') is null
     or to_regclass('public.novel_thumbnail_compositions') is null then
    raise exception 'thumbnail geometry tables are missing';
  end if;

  if not exists (
    select 1
      from public.novel_thumbnail_templates
     where template_key = 'book-v1'
       and canvas_width = 1086
       and canvas_height = 1448
       and cover_mask_source = 'cover_quad'
       and availability_status <> 'emergency_disabled'
  ) then
    raise exception 'book-v1 is not geometry-ready';
  end if;

  select count(*)::integer
    into v_active_count
    from public.novel_thumbnail_assets
   where source_pack_key = 'NOVELIGHT_base_books_32_final'
     and layer_type = 'base_book'
     and template_key = 'book-v1'
     and availability_status = 'active'
     and is_active is true;

  if v_active_count <> 32 then
    raise exception 'official base_book pack must have 32 active assets, found %', v_active_count;
  end if;

  if exists (
    select 1
      from public.novel_thumbnail_compositions c
      join public.novel_thumbnail_assets a on a.id = c.base_book_asset_id
     where c.template_key = 'book-v1'
       and a.source_pack_key is distinct from 'NOVELIGHT_base_books_32_final'
  ) then
    raise exception 'saved composition still references a legacy base_book';
  end if;
end;
$$;
