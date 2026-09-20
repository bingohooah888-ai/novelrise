begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920093847:precheck'));

do $$
begin
  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_collaborators') is null
     or to_regclass('public.author_work_export_audit') is null
     or to_regprocedure('public.novelight_collaboration_can_edit(bigint,uuid)') is null
     or to_regprocedure('public.novelight_authorize_work_export(bigint,text)') is null then
    raise exception 'Episode illustration prerequisites are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='novels'
       and column_name='illustration_ai_usage'
  )
     or to_regclass('public.episode_illustrations') is not null
     or to_regclass('public.episode_illustration_upload_audit') is not null
     or to_regprocedure('public.novelight_authorize_episode_illustration_upload(bigint,uuid)') is not null
     or to_regprocedure('public.novelight_episode_illustration_editor_bundle(bigint,uuid)') is not null
     or to_regprocedure('public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)') is not null
     or to_regprocedure('public.novelight_public_episode_illustration_bundle(bigint)') is not null then
    raise exception 'Episode illustration runtime already exists before migration';
  end if;
end
$$;

rollback;
