-- Record impressions for explicit neutral search sorts (new/PV/favorites).
-- These are intentionally separate from search_recommended so paid/recommended
-- allocation semantics are not mixed into user-selected neutral sorts.

begin;
select pg_advisory_xact_lock(hashtext('novelrise:20260823171500'));

alter table public.novel_exposure_events
  drop constraint if exists novel_exposure_events_surface_check;

alter table public.novel_exposure_events
  add constraint novel_exposure_events_surface_check
  check (surface in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended', 'search_results'));

create or replace function public.record_neutral_search_impressions(
  p_novel_ids text[],
  p_visitor_token text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_inserted integer := 0;
begin
  if p_novel_ids is null or cardinality(p_novel_ids) < 1 or cardinality(p_novel_ids) > 50 then
    raise exception using errcode = '22023', message = 'Search impression batch must contain between 1 and 50 works';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null or length(btrim(p_visitor_token)) < 8 or length(btrim(p_visitor_token)) > 128 then
      raise exception using errcode = '22023', message = 'Anonymous search impressions require a visitor token';
    end if;
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  insert into public.novel_exposure_events (
    viewer_key, viewer_id, surface, novel_id_snapshot, author_id_snapshot,
    plan_snapshot, rule_version, allocation_reason, exposed_at, exposure_hour
  )
  select
    v_viewer_key,
    v_uid,
    'search_results',
    n.id::text,
    n.user_id,
    case lower(coalesce(p.plan, 'free'))
      when 'standard' then 'standard'
      when 'premium' then 'premium'
      else 'free'
    end,
    r.rule_version,
    'balanced',
    now(),
    date_trunc('hour', now())
  from public.novels n
  left join public.profiles p on p.id = n.user_id
  cross join public.novel_exposure_rules r
  where r.id = 1
    and n.status = 'published'
    and n.id::text = any(p_novel_ids)
  on conflict (viewer_key, surface, novel_id_snapshot, exposure_hour) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

revoke all on function public.record_neutral_search_impressions(text[], text) from public;
grant execute on function public.record_neutral_search_impressions(text[], text) to anon, authenticated;

commit;
