-- Rollback for 20260917173000_episode_revision_fk_indexes.sql

drop index if exists public.episode_revisions_user_id_idx;
drop index if exists public.episode_revisions_novel_id_idx;
