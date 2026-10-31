-- Read-only postcheck; must pass inside approved atomic Staging transaction.
do $ai_consent_postcheck$
declare
  v_table text;
  v_rpc text;
  v_role text;
begin
  foreach v_table in array array[
    'novelight_ai_external_processing_consents',
    'novelight_ai_external_consent_action_audit'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null
      or not exists (select 1 from pg_catalog.pg_class c
        where c.oid=pg_catalog.to_regclass('public.' || v_table)
          and c.relrowsecurity) then
      raise exception 'AI consent postcheck: table missing or RLS off';
    end if;
    if not exists (select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename=v_table
        and roles=array['service_role']::name[]
        and policyname in ('ai_external_consent_service_only',
                           'ai_external_consent_audit_service_only')) then
      raise exception 'AI consent postcheck: service-only policy missing';
    end if;
    foreach v_role in array array['anon','authenticated'] loop
      if pg_catalog.has_table_privilege(v_role,'public.' || v_table,'SELECT')
        or pg_catalog.has_table_privilege(v_role,'public.' || v_table,'INSERT')
        or pg_catalog.has_table_privilege(v_role,'public.' || v_table,'UPDATE')
        or pg_catalog.has_table_privilege(v_role,'public.' || v_table,'DELETE') then
        raise exception 'AI consent postcheck: browser table privilege';
      end if;
    end loop;
    if not pg_catalog.has_table_privilege('service_role','public.' || v_table,'SELECT')
      or not pg_catalog.has_table_privilege('service_role','public.' || v_table,'INSERT') then
      raise exception 'AI consent postcheck: service privileges missing';
    end if;
  end loop;
  -- Identity sequence access is not governed by the table's RLS policies.
  if pg_catalog.to_regclass('public.novelight_ai_external_consent_action_audit_id_seq') is null then
    raise exception 'AI consent postcheck: audit sequence missing';
  end if;
  foreach v_role in array array['anon','authenticated'] loop
    if pg_catalog.has_sequence_privilege(v_role,
        'public.novelight_ai_external_consent_action_audit_id_seq','USAGE')
      or pg_catalog.has_sequence_privilege(v_role,
        'public.novelight_ai_external_consent_action_audit_id_seq','SELECT') then
      raise exception 'AI consent postcheck: browser audit sequence privilege';
    end if;
  end loop;
  if not pg_catalog.has_sequence_privilege('service_role',
      'public.novelight_ai_external_consent_action_audit_id_seq','USAGE') then
    raise exception 'AI consent postcheck: service audit sequence privilege missing';
  end if;
  foreach v_rpc in array array[
    'public.novelight_ai_consent_grant(uuid,bigint,text,text)',
    'public.novelight_ai_consent_revoke(uuid,bigint,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_rpc) is null
      or exists (select 1 from pg_catalog.pg_proc
        where oid=pg_catalog.to_regprocedure(v_rpc) and prosecdef)
      or pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE') then
      raise exception 'AI consent postcheck: RPC privilege or invoker mismatch';
    end if;
  end loop;
  if (select count(*) from public.novelight_ai_external_processing_consents) <> 0
    or (select count(*) from public.novelight_ai_external_consent_action_audit) <> 0 then
    raise exception 'AI consent postcheck: consent or audit rows already exist';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (select 1 from public.novelight_ai_runtime_settings
      where singleton=1 and enabled=false
        and user_day_cap_micros=0 and user_month_cap_micros=0
        and global_day_cap_micros=0 and global_month_cap_micros=0) then
    raise exception 'AI consent postcheck: AI switch or budgets changed';
  end if;
end;
$ai_consent_postcheck$;
