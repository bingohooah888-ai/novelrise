\set ON_ERROR_STOP on

select
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'announcements'
       and column_name = 'image_path'
       and is_nullable = 'YES'
  ) as nullable_image_path_exists,
  to_regprocedure('public.novelight_admin_create_announcement_v2(uuid,text,text,text,text,text)') is not null
    as create_v2_exists,
  to_regprocedure('public.novelight_admin_update_announcement_v2(uuid,bigint,text,text,text,text,text)') is not null
    as update_v2_exists;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.announcements;
  if v_count < 1 then
    raise exception 'Expected existing announcement data to be preserved';
  end if;

  if to_regclass('storage.buckets') is not null then
    if not exists (
      select 1
        from storage.buckets
       where id = 'announcement-images'
         and public is true
         and file_size_limit = 5242880
         and allowed_mime_types @> array['image/webp','image/png','image/jpeg']::text[]
    ) then
      raise exception 'announcement-images bucket contract is not satisfied';
    end if;
  end if;
end
$$;
