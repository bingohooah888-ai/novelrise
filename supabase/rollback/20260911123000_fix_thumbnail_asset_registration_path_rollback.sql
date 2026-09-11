-- Roll back the thumbnail asset path hotfix to the immediately preceding
-- Chapter 39 function definition. This intentionally restores the previous
-- fail-closed behavior where official asset registration is rejected.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260911123000:thumbnail-asset-path:rollback'));

create or replace function public.novelight_admin_register_thumbnail_layer_asset(
  p_admin_user_id uuid,
  p_label text,
  p_storage_path text,
  p_image_url text,
  p_layer_type text,
  p_template_key text,
  p_sort_order integer default 1000,
  p_status text default 'active'
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_path text := trim(coalesce(p_storage_path, ''));
  v_url text := trim(coalesce(p_image_url, ''));
  v_layer text := trim(coalesce(p_layer_type, ''));
  v_template text := trim(coalesce(p_template_key, ''));
  v_status text := trim(coalesce(p_status, ''));
  v_row public.novel_thumbnail_assets%rowtype;
begin
  if p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'Admin identity is required';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Thumbnail label is invalid';
  end if;
  if v_path !~ '^official/[0-9a-f-]{36}\\.(webp|png|jpg|jpeg)$' then
    raise exception using errcode = '22023', message = 'Thumbnail storage path is invalid';
  end if;
  if v_url not like 'https://%' then
    raise exception using errcode = '22023', message = 'Thumbnail URL is invalid';
  end if;
  if v_layer not in ('background','base_book','cover','pattern','symbol','frame','effect','cover_mask') then
    raise exception using errcode = '22023', message = 'Thumbnail layer type is invalid';
  end if;
  if v_status not in ('active','retired','emergency_disabled') then
    raise exception using errcode = '22023', message = 'Thumbnail status is invalid';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 100000 then
    raise exception using errcode = '22023', message = 'Thumbnail sort order is invalid';
  end if;
  if not exists (
    select 1 from public.novel_thumbnail_templates t
     where t.template_key = v_template
       and t.availability_status <> 'emergency_disabled'
  ) then
    raise exception using errcode = '22023', message = 'Thumbnail template is unavailable';
  end if;

  insert into public.novel_thumbnail_assets (
    label,
    storage_path,
    image_url,
    is_active,
    created_by,
    layer_type,
    template_key,
    sort_order,
    availability_status
  ) values (
    v_label,
    v_path,
    v_url,
    v_status = 'active',
    p_admin_user_id,
    v_layer,
    v_template,
    p_sort_order,
    v_status
  )
  returning * into v_row;

  if v_layer = 'cover_mask' and v_status = 'active' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = v_path,
           cover_mask_url = v_url,
           updated_at = now()
     where template_key = v_template;
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'thumbnail.layer.create',
    'novel_thumbnail_asset',
    v_row.id::text,
    jsonb_build_object(
      'storage_path', v_row.storage_path,
      'template_key', v_row.template_key,
      'layer_type', v_row.layer_type,
      'status', v_row.availability_status
    )
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_register_thumbnail_layer_asset(
  uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_register_thumbnail_layer_asset(
  uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
