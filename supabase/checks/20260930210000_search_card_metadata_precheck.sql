-- Read-only prerequisite check; run before applying the migration.
do $$
begin
  if to_regprocedure('public.novelight_neutral_search_v2(text,text,text[],text,integer,integer)') is null
     or to_regprocedure('public.novelight_work_completion_status(text)') is null then
    raise exception 'Search v2 and work completion foundations are required';
  end if;
  perform n.id, n.user_id, n.ai_usage, n.content_rating from public.novels n limit 0;
  perform e.novel_id, e.content, e.status, e.scheduled_publish_at from public.episodes e limit 0;
  perform s.novel_id_snapshot, s.is_completed from public.novel_rank_state s limit 0;
  perform p.id, p.display_name from public.profiles p limit 0;
  perform ct.novel_id, ct.display_name, ct.position from public.novel_custom_tags ct limit 0;
end
$$;
