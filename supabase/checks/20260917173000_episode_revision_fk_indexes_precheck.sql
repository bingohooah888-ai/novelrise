-- Read-only precheck for 20260917173000_episode_revision_fk_indexes.sql

do $$
begin
  if to_regclass('public.episode_revisions') is null then
    raise exception 'public.episode_revisions is missing';
  end if;
end;
$$;
