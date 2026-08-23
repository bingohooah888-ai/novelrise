\set ON_ERROR_STOP on

select public.test_assert(not has_table_privilege('anon','public.content_reports','SELECT') and not has_table_privilege('authenticated','public.content_reports','SELECT'),'content reports are private');
select public.test_assert(not has_table_privilege('anon','public.acquisition_touches','SELECT') and not has_table_privilege('authenticated','public.acquisition_touches','SELECT'),'acquisition touches are private');
select public.test_assert(not has_table_privilege('anon','public.beta_activity_days','SELECT') and not has_table_privilege('authenticated','public.beta_activity_days','SELECT'),'activity days are private');
select public.test_assert(not has_table_privilege('anon','public.reader_journey_events','SELECT') and not has_table_privilege('authenticated','public.reader_journey_events','SELECT'),'reader journey events are private');
select public.test_assert(not has_table_privilege('anon','public.subscription_event_log','SELECT') and not has_table_privilege('authenticated','public.subscription_event_log','SELECT'),'subscription event history is private');

do $$
begin
  begin
    insert into public.novels (id,user_id,title,genre,description,status,pv,created_at)
    values ('99000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Unclassified work','SF','must be rejected','published',0,now());
    raise exception 'expected published unclassified work to fail';
  exception when check_violation then null;
  end;
end
$$;

insert into public.novels (
  id,user_id,title,genre,description,status,pv,created_at,
  ai_usage,content_rating,content_warnings,content_policy_ack,content_policy_version
) values (
  '99000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
  'Classified beta work','SF','classified fixture','draft',0,now() - interval '40 days',
  'human','general','{}'::text[],true,'beta-test'
);

update public.novels set status='published'
where id='99000000-0000-0000-0000-000000000002';

select public.test_assert(
  exists (select 1 from public.founding_authors where author_id='11111111-1111-1111-1111-111111111111' and founding_number=1),
  'first qualifying beta author receives Founding Author #1'
);
select public.test_assert(
  exists (
    select 1 from public.novels
    where id='99000000-0000-0000-0000-000000000002'
      and first_published_at >= now() - interval '1 minute'
      and created_at = first_published_at
  ),
  'first publication resets public release time instead of aging from draft creation'
);

-- Toggling draft/published must not reset initial exposure / new-work time.
do $$
declare
  v_first timestamptz;
begin
  select first_published_at into v_first from public.novels
  where id='99000000-0000-0000-0000-000000000002';

  update public.novels set status='draft', created_at=now()
  where id='99000000-0000-0000-0000-000000000002';
  update public.novels set status='published', created_at=now()
  where id='99000000-0000-0000-0000-000000000002';

  if not exists (
    select 1 from public.novels
    where id='99000000-0000-0000-0000-000000000002'
      and first_published_at = v_first
      and created_at = v_first
  ) then
    raise exception 'publication time was reset by republishing';
  end if;
end
$$;

set role anon;
select public.submit_content_report('99000000-0000-0000-0000-000000000002',null,'copyright','Potential unauthorized reproduction for integration test.','visitor-report-test-token','');
reset role;
select public.test_assert((select count(*) from public.content_reports where novel_id_snapshot='99000000-0000-0000-0000-000000000002' and episode_id_snapshot is null)=1,'novel report stored server-side');

set role anon;
select public.submit_content_report('10000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','prohibited_content','Episode moderation integration test report.','visitor-episode-report-token','');
reset role;
select public.test_assert((select count(*) from public.content_reports where novel_id_snapshot='10000000-0000-0000-0000-000000000001' and episode_id_snapshot='11000000-0000-0000-0000-000000000001')=1,'episode report stored server-side');

set role anon;
select public.record_acquisition_touch('visitor-x-test-token','x','social','beta-launch','post-001','/index.html','t.co');
select public.record_beta_visit('visitor-x-test-token','/index.html','x');
reset role;
select public.test_assert(exists(select 1 from public.acquisition_touches where source='x' and campaign='beta-launch'),'X acquisition touch stored');
select public.test_assert(not exists(select 1 from public.acquisition_touches where visitor_key_hash='visitor-x-test-token'),'raw visitor token not stored');

set role anon;
select public.record_reader_journey_event('detail_open','99000000-0000-0000-0000-000000000002',null,'visitor-direct-test-token','x');
reset role;
select public.test_assert(exists(select 1 from public.reader_journey_events where novel_id_snapshot='99000000-0000-0000-0000-000000000002' and event_type='detail_open' and source='x'),'external reader journey preserved');

-- Discovery must keep every plan in the general feed while reserving paid-plan
-- extras as independently measurable surfaces.
set role anon;
select public.test_assert(
  exists(select 1 from public.novelight_discovery_feed_v2('home_discovery',100,null,null,'visitor-all-plan-feed-token') where author_plan='free' and not is_premium_slot)
  and exists(select 1 from public.novelight_discovery_feed_v2('home_discovery',100,null,null,'visitor-all-plan-feed-token') where author_plan='standard' and not is_premium_slot)
  and exists(select 1 from public.novelight_discovery_feed_v2('home_discovery',100,null,null,'visitor-all-plan-feed-token') where author_plan='premium' and not is_premium_slot),
  'general discovery includes Free, Standard, and Premium works'
);
select public.test_assert(
  exists(select 1 from public.novelight_discovery_feed_v2('home_discovery',1,null,null,'visitor-premium-slot-token') where author_plan='premium' and is_premium_slot),
  'Premium dedicated slot remains separate from the general feed'
);
select public.test_assert(
  exists(select 1 from public.novelight_plan_extra_feed(3,'{}'::text[],'visitor-plan-extra-test-token') where author_plan='standard')
  and exists(select 1 from public.novelight_plan_extra_feed(3,'{}'::text[],'visitor-plan-extra-test-token') where author_plan='premium'),
  'plan-extra feed includes both Standard and Premium works'
);

select public.record_novel_impressions_v2('home_discovery',array['81000000-0000-0000-0000-000000000001']::text[],'visitor-free-initial-token');
select public.record_novel_impressions_v2('home_plan_extra',array['81000000-0000-0000-0000-000000000002']::text[],'visitor-standard-extra-token');
select public.record_novel_impressions_v2('home_premium_slot',array['81000000-0000-0000-0000-000000000003']::text[],'visitor-premium-extra-token');
reset role;

select public.test_assert(
  exists(select 1 from public.novel_exposure_events where novel_id_snapshot='81000000-0000-0000-0000-000000000001' and surface='home_discovery' and allocation_reason='initial_exposure'),
  'new Free work receives measurable initial exposure'
);
select public.test_assert(
  exists(select 1 from public.novel_exposure_events where novel_id_snapshot='81000000-0000-0000-0000-000000000002' and surface='home_plan_extra' and allocation_reason='plan_extra'),
  'Standard plan-extra exposure is recorded separately'
);
select public.test_assert(
  exists(select 1 from public.novel_exposure_events where novel_id_snapshot='81000000-0000-0000-0000-000000000003' and surface='home_premium_slot' and allocation_reason='premium_extra'),
  'Premium dedicated exposure is recorded separately'
);

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
set role authenticated;
select public.test_assert(
  exists(select 1 from public.novelight_author_exposure_funnel_v2(30) where novel_id='81000000-0000-0000-0000-000000000002' and plan_extra_impressions >= 1),
  'Standard author analytics reads actual plan-added impressions'
);
reset role;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
set role authenticated;
select public.test_assert(
  exists(select 1 from public.novelight_author_exposure_funnel_v2(30) where novel_id='81000000-0000-0000-0000-000000000003' and premium_slot_impressions >= 1),
  'Premium author analytics reads actual dedicated-slot impressions'
);
reset role;
select set_config('request.jwt.claim.sub','',false);

set role anon;
select public.record_neutral_search_impressions(array['81000000-0000-0000-0000-000000000001']::text[],'visitor-neutral-search-token');
reset role;
select public.test_assert(exists(select 1 from public.novel_exposure_events where surface='search_results' and novel_id_snapshot='81000000-0000-0000-0000-000000000001'),'neutral search impression recorded');

-- Stripe audit history must be private and event IDs must be idempotent.
insert into public.subscription_event_log (
  stripe_event_id,event_type,user_id,stripe_customer_id,stripe_subscription_id,
  plan_snapshot,subscription_status,payment_status,event_created_at
) values (
  'evt_beta_idempotency','customer.subscription.updated','44444444-4444-4444-4444-444444444444',
  'cus_standard','sub_standard','standard','active','active',now()
);
insert into public.subscription_event_log (
  stripe_event_id,event_type,user_id,stripe_customer_id,stripe_subscription_id,
  plan_snapshot,subscription_status,payment_status,event_created_at
) values (
  'evt_beta_idempotency','customer.subscription.updated','44444444-4444-4444-4444-444444444444',
  'cus_standard','sub_standard','standard','active','active',now()
) on conflict (stripe_event_id) do nothing;
select public.test_assert((select count(*) from public.subscription_event_log where stripe_event_id='evt_beta_idempotency')=1,'Stripe event history is idempotent by event ID');
