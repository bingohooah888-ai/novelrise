-- Roll back the additive reference guard before replaying historical illustration schemas.
-- No author content or registered illustration is modified.
begin;

drop trigger if exists novelight_validate_episode_illustration_refs
  on public.episodes;

drop function if exists public.novelight_validate_episode_illustration_refs();

commit;
