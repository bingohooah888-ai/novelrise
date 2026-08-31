\set ON_ERROR_STOP on

select public.test_assert(
  not has_function_privilege('anon', 'public.record_novel_impressions_v2(text,text[],text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_novel_impressions_v2(text,text[],text)', 'execute'),
  'legacy caller-controlled authoritative recorder must be revoked'
);

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.novelight_trusted_discovery_feed('home_discovery', 3, null, null, 'rotatable-anon-token-0001');
reset role;
select public.test_assert(
  not exists (select 1 from public.novel_allocation_receipts),
  'anonymous allocation must not issue authoritative receipts'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  begin
    perform public.record_trusted_allocation_receipts(array[gen_random_uuid()]);
    raise exception 'random receipt unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
create temporary table issued_receipts as
  select novel_id, allocation_receipt
  from public.novelight_trusted_discovery_feed('search_recommended', 3, null, null, null)
  where allocation_receipt is not null;

set role authenticated;
select public.test_assert(
  public.record_trusted_allocation_receipts(array(select allocation_receipt from issued_receipts)) >= 1,
  'legitimate server allocations must be recordable'
);
do $$ begin
  begin
    perform public.record_trusted_allocation_receipts(array(select allocation_receipt from issued_receipts));
    raise exception 'replayed receipt unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

update public.novel_allocation_receipts set consumed_at = null, expires_at = now() - interval '1 second';
set role authenticated;
do $$ begin
  begin
    perform public.record_trusted_allocation_receipts(array(select allocation_receipt from issued_receipts));
    raise exception 'expired receipt unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
set role authenticated;
do $$ begin
  begin
    perform public.record_trusted_allocation_receipts(array(select allocation_receipt from issued_receipts));
    raise exception 'foreign-viewer receipt unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '', false);
select public.record_neutral_search_impressions(
  array['81000000-0000-0000-0000-000000000001'], 'neutral-telemetry-token-0001'
);
select public.test_assert(
  exists (select 1 from public.neutral_search_impression_telemetry)
  and not exists (select 1 from public.novel_exposure_events where surface = 'search_results'),
  'neutral telemetry must remain outside the authoritative ledger'
);

select 'PASS: trusted allocation receipt adversarial behavior' as result;
