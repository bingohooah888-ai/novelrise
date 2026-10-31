-- Read-only prerequisites for a one-time candidate follow-list migration.
-- Do not run this as authorization to write to Staging or Production.
do $follow_list_precheck$
declare
  v_rel text;
begin
  foreach v_rel in array array[
    'public.author_follows', 'public.profiles', 'public.user_blocks'
  ] loop
    if pg_catalog.to_regclass(v_rel) is null then
      raise exception 'Follow list prerequisite table missing: %', v_rel;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = pg_catalog.to_regclass(v_rel) and c.relrowsecurity
    ) then
      raise exception 'Follow list prerequisite RLS disabled: %', v_rel;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.novelight_set_author_follow(uuid,boolean)') is null
    or pg_catalog.to_regprocedure(
      'public.novelight_set_author_follow_notifications(uuid,boolean,boolean)'
    ) is null then
    raise exception 'Existing follow RPC prerequisites unavailable';
  end if;
  if pg_catalog.to_regprocedure('public.novelight_followed_authors(integer,integer)') is not null
    or pg_catalog.to_regprocedure('public.novelight_followers(integer,integer)') is not null
    or pg_catalog.to_regprocedure('public.novelight_follow_counts()') is not null then
    raise exception 'Follow list RPCs already exist; do not overwrite';
  end if;
  if exists (
    select 1 from (
      values
        ('author_follows','follower_user_id'),
        ('author_follows','author_user_id'),
        ('author_follows','notify_new_works'),
        ('author_follows','notify_updates'),
        ('author_follows','created_at'),
        ('profiles','id'),
        ('profiles','display_name'),
        ('profiles','avatar_path'),
        ('user_blocks','blocker_user_id'),
        ('user_blocks','blocked_user_id')
    ) as required(table_name,column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=required.table_name
        and c.column_name=required.column_name
    )
  ) then
    raise exception 'Required follow list column is missing';
  end if;
end
$follow_list_precheck$;
