-- Disable future awards while retaining all discovery state, events, and XP evidence.
begin;
drop trigger if exists novel_rank_events_process_seed_discovery on public.novel_rank_events;
drop function if exists public.novelight_process_seed_discovery_trigger();
drop function if exists public.novelight_process_seed_discovery(uuid);
commit;
