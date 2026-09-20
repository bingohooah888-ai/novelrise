begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920082032:precheck'));

do $$
begin
  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'Episode hearts prerequisites are missing';
  end if;

  if to_regclass('public.episode_hearts') is not null
     or to_regprocedure('public.novelight_episode_heart_state(bigint)') is not null
     or to_regprocedure('public.novelight_toggle_episode_heart(bigint)') is not null then
    raise exception 'Episode hearts objects already exist before migration';
  end if;
end
$$;

rollback;
