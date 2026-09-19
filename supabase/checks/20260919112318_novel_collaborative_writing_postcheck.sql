do $$
begin
  if to_regclass('public.novel_collaborators') is null
     or to_regclass('public.novel_collaboration_invites') is null
     or to_regclass('public.novel_collaboration_events') is null then
    raise exception 'POSTCHECK FAIL: B #22 tables missing';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.novel_collaborators'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.novel_collaboration_invites'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.novel_collaboration_events'::regclass) then
    raise exception 'POSTCHECK FAIL: B #22 RLS disabled';
  end if;

  if has_table_privilege('anon','public.novel_collaborators','select')
     or has_table_privilege('authenticated','public.novel_collaborators','select')
     or has_table_privilege('authenticated','public.novel_collaboration_invites','select')
     or has_table_privilege('authenticated','public.novel_collaboration_events','select')
     or has_table_privilege('service_role','public.novel_collaborators','select') then
    raise exception 'POSTCHECK FAIL: raw B #22 privileges leaked';
  end if;
end
$$;

do $$
begin
  if has_function_privilege(
       'authenticated','public.novelight_collaboration_can_edit(bigint,uuid)','execute'
     )
     or has_function_privilege(
       'anon','public.novelight_collaboration_access(bigint)','execute'
     )
     or has_function_privilege(
       'anon','public.novelight_accept_collaboration_invite(text)','execute'
     )
     or not has_function_privilege(
       'authenticated','public.novelight_collaboration_access(bigint)','execute'
     )
     or not has_function_privilege(
       'authenticated','public.novelight_manage_novel_collaborators(bigint)','execute'
     )
     or not has_function_privilege(
       'authenticated','public.novelight_accept_collaboration_invite(text)','execute'
     )
     or not has_function_privilege(
       'authenticated','public.novelight_create_collaboration_draft(bigint,text,text)','execute'
     )
     or not has_function_privilege(
       'authenticated','public.novelight_update_collaboration_episode(bigint,text,text)','execute'
     ) then
    raise exception 'POSTCHECK FAIL: B #22 RPC privileges incorrect';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='episodes'
       and policyname='novelrise_episodes_update_owner' and cmd='UPDATE'
  ) or not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='episodes'
       and policyname='novelrise_episodes_delete_owner' and cmd='DELETE'
  ) then
    raise exception 'POSTCHECK FAIL: existing owner episode policies changed';
  end if;

  raise notice
    'POSTCHECK PASS: B #22 is raw-private, single-owner, authenticated-RPC-only collaboration';
end
$$;
