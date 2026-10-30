-- Read-only postcheck. Must pass inside the same atomic Staging transaction.
do $ai_review_postcheck$
declare
  v_rls boolean;
  v_role text;
  v_permission text;
  v_rpc text;
begin
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates') is null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb)') is null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text)') is null then
    raise exception 'AI review postcheck failed: missing table or RPC';
  end if;
  select relrowsecurity into v_rls from pg_catalog.pg_class
    where oid = 'public.novelight_ai_review_candidates'::regclass;
  if v_rls is distinct from true then
    raise exception 'AI review postcheck failed: table RLS disabled';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'novelight_ai_review_candidates'
      and policyname = 'ai_review_service_only'
      and roles = array['service_role']::name[]
  ) then
    raise exception 'AI review postcheck failed: service-only policy missing';
  end if;
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_permission in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if pg_catalog.has_table_privilege(v_role,'public.novelight_ai_review_candidates',v_permission) then
        raise exception 'AI review postcheck failed: browser table privilege';
      end if;
    end loop;
    if pg_catalog.has_sequence_privilege(v_role,'public.novelight_ai_review_candidates_id_seq','USAGE')
      or pg_catalog.has_sequence_privilege(v_role,'public.novelight_ai_review_candidates_id_seq','SELECT') then
      raise exception 'AI review postcheck failed: browser sequence privilege';
    end if;
    foreach v_rpc in array array[
      'public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb)',
      'public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text)'
    ] loop
      if pg_catalog.has_function_privilege(v_role,v_rpc,'EXECUTE') then
        raise exception 'AI review postcheck failed: browser RPC execute privilege';
      end if;
    end loop;
  end loop;
  if not pg_catalog.has_table_privilege('service_role','public.novelight_ai_review_candidates','SELECT')
    or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_review_candidates','INSERT')
    or not pg_catalog.has_table_privilege('service_role','public.novelight_ai_review_candidates','UPDATE') then
    raise exception 'AI review postcheck failed: service role privileges missing';
  end if;
  foreach v_rpc in array array[
    'public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb)',
    'public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text)'
  ] loop
    if not pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE') then
      raise exception 'AI review postcheck failed: service-only RPC privileges missing';
    end if;
    if exists (select 1 from pg_catalog.pg_proc where oid=v_rpc::regprocedure and prosecdef) then
      raise exception 'AI review postcheck failed: RPC must be security invoker';
    end if;
  end loop;
  if exists (select 1 from public.novelight_ai_review_candidates) then
    raise exception 'AI review postcheck failed: initial candidate table is not empty';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (
      select 1 from public.novelight_ai_runtime_settings where singleton = 1
        and enabled = false and user_day_cap_micros = 0
        and user_month_cap_micros = 0 and global_day_cap_micros = 0
        and global_month_cap_micros = 0
    ) then
    raise exception 'AI review postcheck failed: runtime activation or budgets changed';
  end if;
end;
$ai_review_postcheck$;
