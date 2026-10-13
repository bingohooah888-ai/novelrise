-- Read-only Staging prerequisite check for the #2190 updated-works feed.
-- Must not mutate application data or migration history.
do $precheck$
begin
  if to_regprocedure('public.novelight_recent_updates_feed(integer,integer)') is not null then
    raise exception 'recent-updates feed already exists; inspect current state before applying';
  end if;

  if to_regprocedure('public.novelight_effective_publication_at(timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'required publication timestamp helper is missing';
  end if;

  if to_regprocedure('public.novelight_is_general_discovery_eligible(text,text)') is null then
    raise exception 'required general discovery eligibility helper is missing';
  end if;

  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null then
    raise exception 'required public discovery tables are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'first_published_at'
  ) then
    raise exception 'episode first-published timestamp is missing';
  end if;
end
$precheck$;
