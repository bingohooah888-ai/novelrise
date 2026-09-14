begin;

alter table public.beta_author_preregistration_events
  drop constraint beta_author_preregistration_events_type_check;

alter table public.beta_author_preregistration_events
  add constraint beta_author_preregistration_events_type_check
  check (event_type in ('page_view', 'cta_click', 'form_start', 'register_click'));

create or replace function public.record_beta_author_preregistration_event(
  p_event_type text,
  p_source text,
  p_visitor_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_source text := lower(trim(coalesce(p_source, 'direct')));
  v_token text := trim(coalesce(p_visitor_token, ''));
  v_visitor_key text;
  v_campaign_state text;
  v_dedupe_interval interval;
  v_recent_exists boolean;
  v_hourly_count integer;
begin
  select config.state
    into v_campaign_state
    from public.beta_author_preregistration_config as config
   where config.id = 1;

  if v_campaign_state is distinct from 'PRE_REGISTRATION' then
    return false;
  end if;

  if v_event_type not in ('page_view', 'cta_click', 'form_start', 'register_click') then
    raise exception 'Unsupported preregistration event.' using errcode = '22023';
  end if;

  if v_source not in ('x', 'youtube', 'dm', 'direct', 'other') then
    v_source := 'other';
  end if;

  if char_length(v_token) <> 64 or v_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  v_visitor_key := md5(v_token);
  v_dedupe_interval := case
    when v_event_type = 'page_view' then interval '60 seconds'
    else interval '5 seconds'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(v_visitor_key || ':' || v_event_type, 0)
  );

  select exists (
    select 1
      from public.beta_author_preregistration_events
     where visitor_key = v_visitor_key
       and event_type = v_event_type
       and created_at >= now() - v_dedupe_interval
  ) into v_recent_exists;

  if v_recent_exists then
    return true;
  end if;

  select count(*)
    into v_hourly_count
    from public.beta_author_preregistration_events
   where visitor_key = v_visitor_key
     and created_at >= now() - interval '1 hour';

  if v_hourly_count >= 120 then
    return false;
  end if;

  insert into public.beta_author_preregistration_events (
    event_type,
    source,
    visitor_key
  ) values (
    v_event_type,
    v_source,
    v_visitor_key
  );

  return true;
end;
$$;

revoke all on function public.record_beta_author_preregistration_event(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.record_beta_author_preregistration_event(
  text, text, text
) to service_role;

comment on table public.beta_author_preregistration_events is
  'Private beta-author LP funnel events. Records page_view, entry CTA click, form start and register click without exposing public read access.';

comment on function public.record_beta_author_preregistration_event(
  text, text, text
) is
  'Server-only preregistration funnel event recorder with campaign-state enforcement, per-event deduplication and bounded per-fingerprint volume.';

commit;
