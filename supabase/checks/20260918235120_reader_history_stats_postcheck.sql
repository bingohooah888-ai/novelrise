\set ON_ERROR_STOP on

do $$
declare
  v_fun regprocedure := 'public.novelight_reader_history_stats(integer)'::regprocedure;
  v_definition text;
begin
  if not (
    select p.prosecdef
      from pg_proc p
     where p.oid = v_fun
  ) then
    raise exception 'POSTCHECK FAIL: B #17 aggregate RPC must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from pg_proc p
     where p.oid = v_fun
       and p.proconfig is not null
       and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
         like '%search_path=""%'
  ) then
    raise exception 'POSTCHECK FAIL: B #17 aggregate RPC must pin empty search_path';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_fun, 'execute')
     or pg_catalog.has_function_privilege('anon', v_fun, 'execute')
     or pg_catalog.has_function_privilege('service_role', v_fun, 'execute') then
    raise exception 'POSTCHECK FAIL: B #17 RPC grants are incorrect';
  end if;

  select lower(pg_catalog.pg_get_functiondef(v_fun))
    into v_definition;

  if position('v.reader_id = v_uid' in v_definition) = 0
     or position('auth.uid()' in v_definition) = 0 then
    raise exception 'POSTCHECK FAIL: B #17 RPC is not bound to current reader';
  end if;

  if position('first_valid_read_per_episode' in v_definition) = 0
     or position('asia/tokyo' in v_definition) = 0
     or position('count(distinct v.novel_id_snapshot)' in v_definition) = 0 then
    raise exception 'POSTCHECK FAIL: B #17 counting semantics changed';
  end if;

  if position('n.status = ''published''' in v_definition) = 0
     or position('e.status = ''published''' in v_definition) = 0 then
    raise exception 'POSTCHECK FAIL: B #17 history must not expose non-public content';
  end if;

  if position('insert into public.' in v_definition) > 0
     or position('update public.' in v_definition) > 0
     or position('delete from public.' in v_definition) > 0
     or position('scout_xp_ledger' in v_definition) > 0
     or position('novel_exposure_events' in v_definition) > 0 then
    raise exception 'POSTCHECK FAIL: B #17 aggregate RPC performs writes or evaluation work';
  end if;
end
$$;

select 'POSTCHECK PASS: B #17 history is private, read-only, and evaluation-neutral' as result;
