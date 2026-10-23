-- SPECIAL isolated branch acceptance only. Do NOT execute against Production
-- or any long-lived Staging branch. The runner MUST independently prove its
-- Supabase project ref is the ephemeral branch before connecting.
-- All test records are wrapped in one transaction and rolled back.
begin;
set local statement_timeout = '20s';
do $special$
declare
  first_project uuid := 'a1111111-1111-4111-8111-111111111111';
  other_project uuid := 'a2222222-2222-4222-8222-222222222222';
  actor uuid := 'a3333333-3333-4333-8333-333333333333';
  item uuid := 'a4444444-4444-4444-8444-444444444444';
  event_hash text := repeat('b',64);
  audit_count integer;
  caught boolean;
begin
  if to_regclass('public.special_projects') is null or
     to_regclass('public.special_contents') is null or
     to_regclass('public.special_permissions') is null or
     to_regclass('public.special_change_log') is null or
     to_regclass('public.special_events') is null
  then raise exception 'SPECIAL_SCHEMA_MISSING'; end if;

  if has_table_privilege('anon','public.special_projects','SELECT') or
     has_table_privilege('authenticated','public.special_permissions','SELECT') or
     has_table_privilege('authenticated','public.special_change_log','SELECT')
  then raise exception 'SPECIAL_RAW_TABLE_EXPOSURE'; end if;

  if exists (
    select 1 from pg_tables
    where schemaname='public' and tablename like 'special_%'
      and not rowsecurity
  ) then raise exception 'SPECIAL_RLS_DISABLED'; end if;

  if to_regclass('storage.buckets') is null then
    raise exception 'SPECIAL_STORAGE_MISSING';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id='special-evidence' and public=false
      and file_size_limit <= 10485760
      and allowed_mime_types @> array['application/pdf','image/png','image/jpeg','image/webp']::text[]
  ) then raise exception 'SPECIAL_PRIVATE_BUCKET_INVALID'; end if;

  insert into public.special_projects
    (id,slug,title,kind,created_by,updated_by)
  values
    (first_project,'special-test-one','TEST ONLY ONE','ss',actor,actor),
    (other_project,'special-test-two','TEST ONLY TWO','ss',actor,actor);

  select count(*) into audit_count from public.special_change_log
  where project_id in (first_project,other_project) and operation='project.insert';
  if audit_count<>2 then raise exception 'SPECIAL_INSERT_AUDIT_MISSING'; end if;

  update public.special_projects set status='published',first_published_at=now()
  where id=first_project;
  if not exists (
    select 1 from public.special_change_log
    where project_id=first_project and operation='status.published'
  ) then raise exception 'SPECIAL_STATUS_AUDIT_MISSING'; end if;

  caught:=false;
  begin
    update public.special_projects set slug='illegal-slug-change'
    where id=first_project;
  exception when others then caught:=true; end;
  if not caught then raise exception 'SPECIAL_PUBLISHED_SLUG_MUTABLE'; end if;

  insert into public.special_contents
    (id,project_id,title,kind,mode,external_url,status,created_by,updated_by)
  values
    (item,first_project,'TEST CONTENT','ss','external','https://example.com/',
    'draft',actor,actor);

  caught:=false;
  begin
    insert into public.special_permissions
      (project_id,content_id,kind,rights_holder,permission_scope,
       evidence_reference,approved_digest,approved_by)
    values
      (other_project,item,'content','TEST HOLDER','TEST SCOPE',
       'test-only-in-rolled-back-transaction',repeat('a',64),actor);
  exception when foreign_key_violation then caught:=true; end;
  if not caught then raise exception 'SPECIAL_CROSS_PROJECT_RIGHTS_ALLOWED'; end if;

  insert into public.special_permissions
    (project_id,content_id,kind,rights_holder,permission_scope,
     evidence_reference,approved_digest,approved_by)
  values
    (first_project,item,'content','TEST HOLDER','TEST SCOPE',
     'test-only-in-rolled-back-transaction',repeat('a',64),actor);
  if not exists (
    select 1 from public.special_change_log
    where project_id=first_project and operation='rights.insert'
  ) then raise exception 'SPECIAL_RIGHTS_AUDIT_MISSING'; end if;

  update public.special_permissions
  set revoked_at=now(),revoked_by=actor where project_id=first_project;
  if not exists (
    select 1 from public.special_change_log
    where project_id=first_project and operation='rights.update'
  ) then raise exception 'SPECIAL_REVOCATION_AUDIT_MISSING'; end if;

  caught:=false;
  begin
    update public.special_change_log
    set operation='tampered' where project_id=first_project;
  exception when others then caught:=true; end;
  if not caught then raise exception 'SPECIAL_AUDIT_MUTABLE'; end if;

  insert into public.special_events
    (project_id,event_type,visitor_hash,target,event_minute)
  values (first_project,'page_view',event_hash,'',date_trunc('minute',now()));

  caught:=false;
  begin
    insert into public.special_events
      (project_id,event_type,visitor_hash,target,event_minute)
    values (first_project,'page_view',event_hash,'',date_trunc('minute',now()));
  exception when unique_violation then caught:=true; end;
  if not caught then raise exception 'SPECIAL_EVENT_DEDUP_DISABLED'; end if;

  raise notice 'SPECIAL isolated branch DB acceptance PASS (all changes rollback)';
end
$special$;
rollback;
