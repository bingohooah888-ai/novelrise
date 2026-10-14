-- Read-only precheck for unified SCOUT activity.
do $pre$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.reader_journey_events') is null
     or to_regclass('public.light_seeds') is null
     or to_regclass('public.favorites') is null then
    raise exception 'SCOUT activity sources are missing';
  end if;
  if to_regprocedure('public.record_reader_journey_event(text,text,text,text,text)') is null then
    raise exception 'Reader journey recorder is missing';
  end if;
  if to_regprocedure('public.novelight_scout_activity_feed(text,integer,integer)') is not null then
    raise exception 'Unified SCOUT activity feed already exists';
  end if;
end;
$pre$;
