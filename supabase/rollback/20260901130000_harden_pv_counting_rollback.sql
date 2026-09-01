-- NOVELIGHT: rollback authoritative PV counting.
-- This restores the previous RPC permissions and removes the PV audit ledger.
-- It does not attempt to decrement PV counters that were legitimately counted
-- while the hardening migration was active.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260901130000:rollback'));

drop function if exists public.record_episode_pv(text, text);
drop table if exists public.episode_pv_events;

do $$
begin
  if to_regprocedure('public.increment_novel_pv(bigint)') is not null then
    execute 'grant execute on function public.increment_novel_pv(bigint) to public, anon, authenticated';
  end if;

  if to_regprocedure('public.increment_episode_pv(bigint)') is not null then
    execute 'grant execute on function public.increment_episode_pv(bigint) to public, anon, authenticated';
  end if;
end
$$;

commit;
