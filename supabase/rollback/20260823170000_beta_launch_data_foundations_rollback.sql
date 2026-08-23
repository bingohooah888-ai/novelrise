-- Roll back beta-launch data foundations.
-- WARNING: this removes beta-only ledgers and therefore deletes data captured by
-- them. Use only before public beta or after an explicit data-impact review.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823170000'));

drop trigger if exists novels_assign_founding_author on public.novels;
drop function if exists public.assign_founding_author();
drop table if exists public.founding_authors;

drop function if exists public.record_reader_journey_event(text, text, text, text, text);
drop table if exists public.reader_journey_events;

drop function if exists public.record_beta_visit(text, text, text);
drop table if exists public.beta_activity_days;

drop function if exists public.claim_user_acquisition(text);
drop function if exists public.record_acquisition_touch(text, text, text, text, text, text, text);
drop table if exists public.user_lifecycle;
drop table if exists public.user_acquisition;
drop table if exists public.acquisition_touches;

drop function if exists public.submit_content_report(text, text, text, text, text, text);
drop table if exists public.content_reports;

drop table if exists public.subscription_event_log;

drop trigger if exists novels_beta_classification_guard on public.novels;
drop function if exists public.enforce_novel_beta_classification();

alter table public.novels
  drop constraint if exists novels_ai_usage_check,
  drop constraint if exists novels_content_rating_check,
  drop column if exists content_policy_version,
  drop column if exists content_policy_ack,
  drop column if exists content_warnings,
  drop column if exists content_rating,
  drop column if exists ai_usage;

commit;
