do $$ begin
  if to_regclass('public.novel_exposure_events') is null
     or to_regprocedure('public.novelight_discovery_feed_v2(text,integer,text,text,text)') is null then
    raise exception 'trusted receipt prerequisites are missing';
  end if;
end $$;
