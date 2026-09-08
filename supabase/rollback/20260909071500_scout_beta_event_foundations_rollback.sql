-- Roll back NOVELIGHT SCOUT / LIGHT SEED beta event foundations.
-- This restores the preceding staged LIGHT SEED v1 schema without touching
-- historical v1 rows or unrelated production data.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909071500'));

drop function if exists public.plant_light_seed_v2(text, text);
drop function if exists public.light_seed_status_v2(text);
drop function if exists public.record_valid_read_progress(text, uuid, double precision, integer, integer);

drop trigger if exists light_seeds_capture_scout_event on public.light_seeds;
drop function if exists public.novelight_capture_light_seed_event();

drop trigger if exists light_seeds_snapshot_rank on public.light_seeds;
drop function if exists public.novelight_snapshot_light_seed_rank();

drop trigger if exists novels_ensure_rank_state on public.novels;
drop function if exists public.novelight_ensure_rank_state_for_published_novel();

drop trigger if exists novel_rank_state_capture_change on public.novel_rank_state;
drop function if exists public.novelight_capture_rank_change();

drop trigger if exists novel_rank_state_normalize on public.novel_rank_state;
drop function if exists public.novelight_normalize_rank_state();

drop function if exists public.novelight_ensure_light_seed_inventory(uuid, date);

drop table if exists public.seed_discovery_state;

alter table public.light_seeds
  drop constraint if exists light_seeds_seed_type_check,
  drop constraint if exists light_seeds_rank_at_seed_check,
  drop constraint if exists light_seeds_rank_code_check;

alter table public.light_seeds
  drop column if exists valid_read_event_id,
  drop column if exists rank_code_at_seed,
  drop column if exists rank_at_seed,
  drop column if exists seed_type;

drop table if exists public.light_seed_monthly_inventory;
drop table if exists public.valid_read_events;
drop table if exists public.valid_read_sessions;
drop table if exists public.valid_read_rules;
drop table if exists public.novel_rank_events;
drop table if exists public.novel_rank_state;
drop table if exists public.scout_xp_ledger;
drop table if exists public.scout_event_ledger;

drop function if exists public.novelight_rank_code(smallint);

commit;