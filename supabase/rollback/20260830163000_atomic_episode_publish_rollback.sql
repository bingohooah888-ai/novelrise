begin;

drop function if exists public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
);

commit;
