-- Read-only postcheck for 20260917173000_episode_revision_fk_indexes.sql

do $$
begin
  if to_regclass('public.episode_revisions_novel_id_idx') is null then
    raise exception 'episode_revisions_novel_id_idx is missing';
  end if;

  if to_regclass('public.episode_revisions_user_id_idx') is null then
    raise exception 'episode_revisions_user_id_idx is missing';
  end if;
end;
$$;
