-- Follow-up performance hardening for competitor audit #8 episode revision history.
-- Adds covering indexes for the remaining foreign keys reported by Supabase advisor.

create index if not exists episode_revisions_novel_id_idx
  on public.episode_revisions (novel_id);

create index if not exists episode_revisions_user_id_idx
  on public.episode_revisions (user_id);
