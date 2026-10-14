-- Read-only postcheck; do not expose activity across readers.
do $post$
declare
  v_def text;
  v_constraint text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.oid = to_regprocedure('public.record_reader_journey_event(text,text,text,text,text)');
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.reader_journey_events'::regclass
     and c.conname = 'reader_journey_events_event_type_check';

  if v_def not like '%x_share_open%' or v_constraint not like '%x_share_open%' then
    raise exception 'X share opening event was not registered';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.novelight_scout_activity_feed(text,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.novelight_scout_activity_feed(text,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'SCOUT unified feed privileges are unsafe';
  end if;
end;
$post$;
