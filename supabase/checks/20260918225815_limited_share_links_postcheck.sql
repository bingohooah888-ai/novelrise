\set ON_ERROR_STOP on

do $$
declare
  v_owner_status regprocedure := 'public.novelight_share_link_status(bigint)'::regprocedure;
  v_owner_rotate regprocedure := 'public.novelight_rotate_share_link(bigint)'::regprocedure;
  v_owner_revoke regprocedure := 'public.novelight_revoke_share_link(bigint)'::regprocedure;
  v_public_novel regprocedure := 'public.novelight_shared_novel(text)'::regprocedure;
  v_public_episode regprocedure := 'public.novelight_shared_episode(text,bigint)'::regprocedure;
  v_trigger regprocedure := 'public._novelight_revoke_share_link_when_public()'::regprocedure;
  v_definition text;
begin
  if to_regclass('public.novel_share_links') is null then
    raise exception 'POSTCHECK FAIL: novel_share_links is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novel_share_links'::regclass) then
    raise exception 'POSTCHECK FAIL: novel_share_links RLS is disabled';
  end if;

  if has_table_privilege('anon', 'public.novel_share_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_share_links', 'SELECT')
     or has_table_privilege('service_role', 'public.novel_share_links', 'SELECT')
     or has_table_privilege('anon', 'public.novel_share_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_share_links', 'INSERT')
     or has_table_privilege('service_role', 'public.novel_share_links', 'INSERT') then
    raise exception 'POSTCHECK FAIL: raw share-link secrets are client-accessible';
  end if;

  if not has_function_privilege('authenticated', v_owner_status, 'EXECUTE')
     or has_function_privilege('anon', v_owner_status, 'EXECUTE')
     or not has_function_privilege('authenticated', v_owner_rotate, 'EXECUTE')
     or has_function_privilege('anon', v_owner_rotate, 'EXECUTE')
     or not has_function_privilege('authenticated', v_owner_revoke, 'EXECUTE')
     or has_function_privilege('anon', v_owner_revoke, 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: owner RPC grants are incorrect';
  end if;

  if not has_function_privilege('anon', v_public_novel, 'EXECUTE')
     or not has_function_privilege('authenticated', v_public_novel, 'EXECUTE')
     or not has_function_privilege('anon', v_public_episode, 'EXECUTE')
     or not has_function_privilege('authenticated', v_public_episode, 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: token reader RPC grants are incorrect';
  end if;

  if has_function_privilege('service_role', v_owner_status, 'EXECUTE')
     or has_function_privilege('service_role', v_owner_rotate, 'EXECUTE')
     or has_function_privilege('service_role', v_owner_revoke, 'EXECUTE')
     or has_function_privilege('service_role', v_public_novel, 'EXECUTE')
     or has_function_privilege('service_role', v_public_episode, 'EXECUTE')
     or has_function_privilege('anon', v_trigger, 'EXECUTE')
     or has_function_privilege('authenticated', v_trigger, 'EXECUTE')
     or has_function_privilege('service_role', v_trigger, 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: function grants are broader than intended';
  end if;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       v_owner_status::oid,
       v_owner_rotate::oid,
       v_owner_revoke::oid,
       v_public_novel::oid,
       v_public_episode::oid,
       v_trigger::oid
     )
       and (
         not p.prosecdef
         or p.proconfig is null
         or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=""%'
       )
  ) then
    raise exception 'POSTCHECK FAIL: B #16 privileged functions must pin empty search_path';
  end if;

  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.novels'::regclass
       and t.tgname = 'novelight_revoke_share_link_when_public'
       and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: publish-time share revocation trigger is missing';
  end if;

  select lower(pg_get_functiondef(v_owner_rotate))
    into v_definition;
  if position('n.status = ''draft''' in v_definition) = 0
     or position('sha256' in v_definition) = 0
     or position('gen_random_uuid' in v_definition) = 0 then
    raise exception 'POSTCHECK FAIL: rotate RPC lost draft-only or token-hardening contract';
  end if;

  select lower(pg_get_functiondef(v_public_novel))
    into v_definition;
  if position('n.status = ''draft''' in v_definition) = 0
     or position('sha256' in v_definition) = 0
     or position('pv' in v_definition) > 0
     or position('favorite' in v_definition) > 0
     or position('rank' in v_definition) > 0
     or position('scout' in v_definition) > 0 then
    raise exception 'POSTCHECK FAIL: shared novel RPC is not draft-only/evaluation-neutral';
  end if;

  select lower(pg_get_functiondef(v_public_episode))
    into v_definition;
  if position('n.status = ''draft''' in v_definition) = 0
     or position('update public.novels' in v_definition) > 0
     or position('update public.episodes' in v_definition) > 0
     or position('insert into public.' in v_definition) > 0 then
    raise exception 'POSTCHECK FAIL: shared episode RPC performs non-read behavior';
  end if;
end
$$;

select 'POSTCHECK PASS: B #16 sharing is draft-only, token-bound, and evaluation-neutral' as result;
