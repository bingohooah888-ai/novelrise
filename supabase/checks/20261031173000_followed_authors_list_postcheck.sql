-- Read-only postconditions, suitable inside a single transaction.
-- Assert no new raw-table permissions and require the exact 3 RPC interfaces.
do $follow_list_postcheck$
declare
  v_fn text;
  v_oid oid;
  v_def text;
begin
  foreach v_fn in array array[
    'public.novelight_followed_authors(integer,integer)',
    'public.novelight_followers(integer,integer)',
    'public.novelight_follow_counts()'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_fn);
    if v_oid is null then
      raise exception 'Missing follow list RPC: %', v_fn;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_oid
        and p.prosecdef
        and p.prorettype = 'jsonb'::pg_catalog.regtype
        and p.proconfig @> array['search_path=']::text[]
    ) then
      raise exception 'Invalid function security contract: %', v_fn;
    end if;
    if pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
      or exists (
        select 1
        from pg_catalog.pg_proc p,
        pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        where p.oid = v_oid and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'Incorrect follow list RPC execution privileges: %', v_fn;
    end if;
    v_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid));
    if pg_catalog.strpos(v_def, 'auth.uid()') = 0
       or pg_catalog.strpos(v_def, 'v_uid is null') = 0
       or pg_catalog.strpos(v_def, 'user_blocks') = 0 then
      raise exception 'RPC owner-bound or blocked-user check absent: %', v_fn;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('anon', 'public.author_follows', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.user_blocks', 'SELECT') then
    raise exception 'Private relationship tables unexpectedly readable by anon';
  end if;
end
$follow_list_postcheck$;
