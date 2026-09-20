begin;

do $$
declare
  v_fun oid;
  v_definition text;
begin
  if to_regclass('public.episode_illustrations') is null then
    raise exception 'POSTCHECK FAIL: episode_illustrations table missing';
  end if;

  if to_regclass('public.episode_illustration_upload_audit') is null then
    raise exception 'POSTCHECK FAIL: illustration upload audit table missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='novels'
       and column_name='illustration_ai_usage'
       and data_type='boolean'
       and is_nullable='YES'
  ) then
    raise exception 'POSTCHECK FAIL: illustration_ai_usage declaration missing';
  end if;

  if not (
    select c.relrowsecurity
      from pg_class c
     where c.oid='public.episode_illustrations'::regclass
  ) then
    raise exception 'POSTCHECK FAIL: episode_illustrations RLS disabled';
  end if;

  if not (
    select c.relrowsecurity
      from pg_class c
     where c.oid='public.episode_illustration_upload_audit'::regclass
  ) then
    raise exception 'POSTCHECK FAIL: illustration upload audit RLS disabled';
  end if;

  if has_table_privilege('anon','public.episode_illustrations','select')
     or has_table_privilege('authenticated','public.episode_illustrations','select')
     or has_table_privilege('authenticated','public.episode_illustrations','insert')
     or has_table_privilege('authenticated','public.episode_illustrations','update')
     or has_table_privilege('authenticated','public.episode_illustrations','delete')
     or has_table_privilege('service_role','public.episode_illustrations','select') then
    raise exception 'POSTCHECK FAIL: raw illustration table privileges leaked';
  end if;

  if has_table_privilege('anon','public.episode_illustration_upload_audit','select')
     or has_table_privilege('authenticated','public.episode_illustration_upload_audit','select')
     or has_table_privilege('service_role','public.episode_illustration_upload_audit','select') then
    raise exception 'POSTCHECK FAIL: raw illustration upload audit privileges leaked';
  end if;

  foreach v_fun in array array[
    to_regprocedure('public.novelight_authorize_episode_illustration_upload(bigint,uuid)')::oid,
    to_regprocedure('public.novelight_episode_illustration_editor_bundle(bigint,uuid)')::oid,
    to_regprocedure('public.novelight_set_illustration_ai_usage(bigint,uuid,boolean)')::oid,
    to_regprocedure('public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)')::oid,
    to_regprocedure('public.novelight_update_episode_illustration_alt(uuid,uuid,text)')::oid,
    to_regprocedure('public.novelight_public_episode_illustration_bundle(bigint)')::oid,
    to_regprocedure('public.novelight_owner_illustration_export_bundle(bigint,uuid)')::oid
  ]
  loop
    if v_fun is null or not exists (
      select 1 from pg_proc p
       where p.oid=v_fun
         and p.prosecdef
         and p.proconfig is not null
         and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=""%'
    ) then
      raise exception 'POSTCHECK FAIL: illustration service RPC hardening missing';
    end if;

    if has_function_privilege('anon', v_fun, 'EXECUTE')
       or has_function_privilege('authenticated', v_fun, 'EXECUTE')
       or not has_function_privilege('service_role', v_fun, 'EXECUTE') then
      raise exception 'POSTCHECK FAIL: illustration service RPC privileges incorrect';
    end if;
  end loop;

  select lower(pg_get_functiondef(
    to_regprocedure('public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)')::oid
  )) into v_definition;

  if v_definition ~ 'light_seed|scout|work_rank|novel_exposure|record_episode_pv|favorites' then
    raise exception 'POSTCHECK FAIL: illustration registration must remain evaluation-neutral';
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid='public.author_work_export_audit'::regclass
       and c.conname='author_work_export_audit_format_check'
       and pg_get_constraintdef(c.oid) like '%txt%'
       and pg_get_constraintdef(c.oid) like '%zip%'
  ) then
    raise exception 'POSTCHECK FAIL: complete illustration ZIP export format is not authorized';
  end if;

  if to_regclass('storage.buckets') is not null then
    if not exists (
      select 1 from storage.buckets b
       where b.id='episode-illustrations'
         and b.public=false
         and b.file_size_limit=10485760
         and b.allowed_mime_types=array['image/webp']::text[]
    ) then
      raise exception 'POSTCHECK FAIL: private episode illustration bucket contract missing';
    end if;
  end if;

  raise notice 'POSTCHECK PASS: episode illustrations are private, service mediated, bounded, and evaluation-neutral';
end
$$;

rollback;
