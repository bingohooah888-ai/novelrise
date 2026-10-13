-- Revert only the dedicated #2190 discovery RPC; existing feeds stay intact.
-- Operator-only rollback after reviewing current Production/Staging state.
begin;
drop function if exists public.novelight_recent_updates_feed(integer, integer);
commit;
