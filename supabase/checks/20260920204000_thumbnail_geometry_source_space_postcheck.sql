-- Postcheck for one canonical source-space geometry path.

do $$
declare
  v_template public.novel_thumbnail_templates%rowtype;
  v_active_count integer;
begin
  select *
    into v_template
    from public.novel_thumbnail_templates
   where template_key = 'book-v1';

  if not found
     or v_template.cover_quad_space <> 'base_book_source'
     or v_template.base_book_source_width <> 1024
     or v_template.base_book_source_height <> 1536
     or v_template.cover_top_left_x <> 164
     or v_template.cover_top_left_y <> 360
     or v_template.cover_top_right_x <> 714
     or v_template.cover_top_right_y <> 252
     or v_template.cover_bottom_right_x <> 984
     or v_template.cover_bottom_right_y <> 1003
     or v_template.cover_bottom_left_x <> 319
     or v_template.cover_bottom_left_y <> 1156 then
    raise exception 'book-v1 source-space geometry does not match canonical values';
  end if;

  if not public.novelight_geometry_quad_valid(
    1024, 1536,
    v_template.cover_top_left_x, v_template.cover_top_left_y,
    v_template.cover_top_right_x, v_template.cover_top_right_y,
    v_template.cover_bottom_right_x, v_template.cover_bottom_right_y,
    v_template.cover_bottom_left_x, v_template.cover_bottom_left_y
  ) then
    raise exception 'book-v1 canonical source quad is invalid';
  end if;

  if to_regprocedure('public.novelight_thumbnail_compositions_v3(bigint[])') is null then
    raise exception 'novelight_thumbnail_compositions_v3 is missing';
  end if;

  select count(*)::integer into v_active_count
    from public.novel_thumbnail_assets
   where source_pack_key = 'NOVELIGHT_base_books_32_final'
     and layer_type = 'base_book'
     and template_key = 'book-v1'
     and availability_status = 'active'
     and is_active is true;
  if v_active_count <> 32 then
    raise exception 'official base_book active count changed: %', v_active_count;
  end if;

  if exists (
    select 1 from public.novel_thumbnail_compositions
     where template_key = 'book-v1' and render_url is not null
  ) then
    raise exception 'stale book-v1 render cache remains';
  end if;

  if exists (
    select 1
      from public.novels n
      join public.novel_thumbnail_compositions c on c.novel_id = n.id
     where c.template_key = 'book-v1'
       and n.thumbnail_asset_id is null
       and n.thumbnail_url is not null
  ) then
    raise exception 'stale novel thumbnail_url remains for book-v1 composition';
  end if;
end;
$$;
