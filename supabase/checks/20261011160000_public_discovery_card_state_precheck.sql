-- Read-only schema prerequisite and collision check for discovery cards.
-- Do not touch authored novels, episodes, or publication state.
do $$
begin
  if to_regclass('public.novels') is null
    or to_regclass('public.episodes') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.novel_rank_state') is null
    or to_regprocedure('public.novelight_is_general_discovery_eligible(text,text)') is null then
    raise exception 'Public discovery card prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_public_discovery_card_state(bigint[])') is not null then
    raise exception 'Discovery card RPC already exists; inspect before migration';
  end if;

  perform n.id, n.user_id, n.status, n.ai_usage, n.content_rating
  from public.novels n limit 0;

  perform e.novel_id, e.status, e.scheduled_publish_at,
    e.first_published_at, e.created_at
  from public.episodes e limit 0;

  perform p.id, p.display_name from public.profiles p limit 0;
  perform s.novel_id_snapshot, s.is_completed
  from public.novel_rank_state s limit 0;
end
$$;
