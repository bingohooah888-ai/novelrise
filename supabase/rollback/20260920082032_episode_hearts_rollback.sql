begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920082032:rollback'));

do $$
begin
  if to_regclass('public.episode_hearts') is not null
     and exists(select 1 from public.episode_hearts limit 1) then
    raise exception 'Rollback blocked: episode hearts contain user reaction data';
  end if;
end
$$;

drop function if exists public.novelight_toggle_episode_heart(bigint);
drop function if exists public.novelight_episode_heart_state(bigint);
drop table if exists public.episode_hearts;

commit;
