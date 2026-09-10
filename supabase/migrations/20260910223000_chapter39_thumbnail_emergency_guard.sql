-- Chapter 39 emergency controls.
-- A cover mask is part of the template contract, and emergency-disabled source
-- material must disappear even when an older composed WebP was cached.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910223000'));

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

drop trigger if exists novelight_validate_thumbnail_composition_template
  on public.novel_thumbnail_compositions;
create trigger novelight_validate_thumbnail_composition_template
before insert or update of template_key
on public.novel_thumbnail_compositions
for each row execute function public.novelight_validate_thumbnail_composition_template();

create or replace function public.novelight_thumbnail_compositions(
  p_novel_ids bigint[]
)
returns table (
  novel_id bigint,
  template_key text,
  canvas_width integer,
  canvas_height integer,
  cover_mask_url text,
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
    case
      when t.availability_status <> 'emergency_disabled' then t.cover_mask_url
    end,
    case
      when bg.availability_status <> 'emergency_disabled' then bg.image_url
    end,
    case
      when book.availability_status <> 'emergency_disabled' then book.image_url
    end,
    case
      when t.cover_mask_url is not null
       and cover.availability_status <> 'emergency_disabled' then cover.image_url
    end,
    case
      when t.cover_mask_url is not null
       and pattern.availability_status <> 'emergency_disabled' then pattern.image_url
    end,
    case
      when t.cover_mask_url is not null
       and symbol.availability_status <> 'emergency_disabled' then symbol.image_url
    end,
    case
      when t.cover_mask_url is not null
       and frame.availability_status <> 'emergency_disabled' then frame.image_url
    end,
    case
      when effect.availability_status <> 'emergency_disabled' then effect.image_url
    end,
    c.revision,
    case
      when t.availability_status <> 'emergency_disabled'
       and t.cover_mask_url is not null
       and bg.availability_status <> 'emergency_disabled'
       and book.availability_status <> 'emergency_disabled'
       and cover.availability_status <> 'emergency_disabled'
       and coalesce(pattern.availability_status, 'active') <> 'emergency_disabled'
       and coalesce(symbol.availability_status, 'active') <> 'emergency_disabled'
       and coalesce(frame.availability_status, 'active') <> 'emergency_disabled'
       and coalesce(effect.availability_status, 'active') <> 'emergency_disabled'
      then c.render_url
    end
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
    and (n.status = 'published' or (select auth.uid()) = n.user_id);
end;
$$;

revoke all on function public.novelight_thumbnail_compositions(bigint[]) from public;
grant execute on function public.novelight_thumbnail_compositions(bigint[])
  to anon, authenticated;

create or replace function public.novelight_admin_set_thumbnail_asset_status(
  p_admin_user_id uuid,
  p_asset_id uuid,
  p_status text
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.novel_thumbnail_assets%rowtype;
  v_status text := trim(coalesce(p_status, ''));
begin
  if p_admin_user_id is null or p_asset_id is null then
    raise exception using errcode = '22023', message = 'Admin identity and asset are required';
  end if;
  if v_status not in ('active','retired','emergency_disabled') then
    raise exception using errcode = '22023', message = 'Thumbnail status is invalid';
  end if;

  update public.novel_thumbnail_assets
     set availability_status = v_status,
         is_active = v_status = 'active'
   where id = p_asset_id
  returning * into v_row;

  if not found then
    raise exception using errcode = 'P0002', message = 'Thumbnail asset not found';
  end if;

  if v_row.layer_type = 'cover_mask' and v_status = 'active' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = v_row.storage_path,
           cover_mask_url = v_row.image_url,
           updated_at = now()
     where template_key = v_row.template_key;
  elsif v_row.layer_type = 'cover_mask' and v_status = 'emergency_disabled' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = null,
           cover_mask_url = null,
           updated_at = now()
     where template_key = v_row.template_key
       and cover_mask_storage_path = v_row.storage_path;
  end if;

  if v_status = 'emergency_disabled' then
    if v_row.layer_type = 'cover_mask' then
      update public.novel_thumbnail_compositions c
         set revision = gen_random_uuid(),
             render_storage_path = null,
             render_url = null,
             updated_at = now()
       where c.template_key = v_row.template_key;

      update public.novels n
         set thumbnail_url = null
       from public.novel_thumbnail_compositions c
       where n.id = c.novel_id
         and c.template_key = v_row.template_key
         and n.thumbnail_asset_id is null;
    elsif v_row.layer_type = 'legacy_complete' then
      update public.novels
         set thumbnail_url = null
       where thumbnail_asset_id = p_asset_id;
    else
      update public.novel_thumbnail_compositions c
         set revision = gen_random_uuid(),
             render_storage_path = null,
             render_url = null,
             updated_at = now()
       where c.background_asset_id = p_asset_id
          or c.base_book_asset_id = p_asset_id
          or c.cover_asset_id = p_asset_id
          or c.pattern_asset_id = p_asset_id
          or c.symbol_asset_id = p_asset_id
          or c.frame_asset_id = p_asset_id
          or c.effect_asset_id = p_asset_id;

      update public.novels n
         set thumbnail_url = null
       from public.novel_thumbnail_compositions c
       where n.id = c.novel_id
         and n.thumbnail_asset_id is null
         and (
           c.background_asset_id = p_asset_id
           or c.base_book_asset_id = p_asset_id
           or c.cover_asset_id = p_asset_id
           or c.pattern_asset_id = p_asset_id
           or c.symbol_asset_id = p_asset_id
           or c.frame_asset_id = p_asset_id
           or c.effect_asset_id = p_asset_id
         );
    end if;
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'thumbnail.layer.status',
    'novel_thumbnail_asset',
    v_row.id::text,
    jsonb_build_object('status', v_status)
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_set_thumbnail_asset_status(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_set_thumbnail_asset_status(
  uuid, uuid, text
) to service_role;

commit;
