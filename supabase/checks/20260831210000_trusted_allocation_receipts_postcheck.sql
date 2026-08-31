do $$ begin
  if to_regclass('public.novel_allocation_receipts') is null
     or to_regclass('public.neutral_search_impression_telemetry') is null
     or to_regprocedure('public.record_trusted_allocation_receipts(uuid[])') is null then
    raise exception 'trusted allocation receipt objects are missing';
  end if;
  if has_function_privilege('anon', 'public.record_novel_impressions_v2(text,text[],text)', 'execute')
     or has_function_privilege('authenticated', 'public.record_novel_impressions_v2(text,text[],text)', 'execute')
     or has_function_privilege('anon', 'public.record_trusted_allocation_receipts(uuid[])', 'execute') then
    raise exception 'authoritative exposure recorder privilege is unsafe';
  end if;
  if not has_function_privilege('authenticated', 'public.record_trusted_allocation_receipts(uuid[])', 'execute') then
    raise exception 'authenticated trusted recorder privilege is missing';
  end if;
end $$;
