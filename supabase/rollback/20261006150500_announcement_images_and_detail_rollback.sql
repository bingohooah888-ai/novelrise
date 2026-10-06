\set ON_ERROR_STOP on

do $$
declare
  v_has_referenced_images boolean := false;
  v_has_storage_objects boolean := false;
begin
  if to_regclass('public.announcements') is not null then
    execute 'select exists (select 1 from public.announcements where image_path is not null limit 1)'
      into v_has_referenced_images;
  end if;

  if to_regclass('storage.objects') is not null then
    execute $sql$
      select exists (
        select 1
          from storage.objects
         where bucket_id = 'announcement-images'
         limit 1
      )
    $sql$
      into v_has_storage_objects;
  end if;

  if v_has_referenced_images or v_has_storage_objects then
    raise exception 'Refusing rollback: announcement image references or Storage objects exist. Remove/export them explicitly before dropping the image feature.';
  end if;
end
$$;

begin;

drop function if exists public.novelight_admin_update_announcement_v2(uuid, bigint, text, text, text, text, text);
drop function if exists public.novelight_admin_create_announcement_v2(uuid, text, text, text, text, text);

alter table public.announcements
  drop constraint if exists announcements_image_path_check;

alter table public.announcements
  drop column if exists image_path;

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  delete from storage.buckets
   where id = 'announcement-images';
end
$$;

commit;
