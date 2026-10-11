-- Remove only the optional public discovery-card RPC.
-- Revert the three discovery-list frontend callers first, or confirm all
-- callers safely use their existing search-card metadata fallback.
-- Do not execute rollback automatically; Production rollback requires approval.
begin;
drop function if exists public.novelight_public_discovery_card_state(bigint[]);
commit;
