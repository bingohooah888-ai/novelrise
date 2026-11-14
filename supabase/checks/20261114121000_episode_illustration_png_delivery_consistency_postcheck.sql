-- Read-only assertions after applying the matching migration.
begin;
do $$
declare v_fn oid := pg_catalog.to_regprocedure(
  'public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)'
)::oid;
begin
  if not exists (
    select 1 from storage.buckets b
    where b.id='episode-illustrations' and b.public=false
      and b.file_size_limit=10485760
      and b.allowed_mime_types=array['image/webp','image/png']::text[]
  ) then
    raise exception 'POSTCHECK FAIL: private bucket WebP/PNG MIME contract mismatch';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.episode_illustrations'::regclass
      and c.conname='episode_illustrations_mime_type_check'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%image/png%'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.episode_illustrations'::regclass
      and c.conname='episode_illustrations_mime_extension_check'
  ) then
    raise exception 'POSTCHECK FAIL: registry MIME and extension contracts missing';
  end if;
  if v_fn is null
     or not pg_catalog.pg_get_functiondef(v_fn) like '%image/png%'
     or not pg_catalog.pg_get_functiondef(v_fn) like '%i.deleted_at is null%'
     or not pg_catalog.pg_get_functiondef(v_fn) like '%novelight_collaboration_can_edit%'
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=v_fn)
     or pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
  then
    raise exception 'POSTCHECK FAIL: service-only PNG registry or safety contract mismatch';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c
            where c.oid='public.episode_illustrations'::regclass)
     or pg_catalog.has_table_privilege('authenticated','public.episode_illustrations','select')
  then
    raise exception 'POSTCHECK FAIL: registry RLS/privileges weakened';
  end if;
  raise notice 'POSTCHECK PASS: WebP/PNG storage, registry, private access and quota contract aligned';
end
$$;
rollback;
