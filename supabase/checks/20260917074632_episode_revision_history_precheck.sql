-- Read-only precheck for 20260917074632_episode_revision_history.sql

do $$
begin
  if to_regclass('public.episodes') is null then
    raise exception 'precheck failed: public.episodes is missing';
  end if;
  if to_regclass('public.novels') is null then
    raise exception 'precheck failed: public.novels is missing';
  end if;
  if to_regclass('public.episode_revisions') is not null then
    raise exception 'precheck failed: public.episode_revisions already exists';
  end if;
end
$$;
