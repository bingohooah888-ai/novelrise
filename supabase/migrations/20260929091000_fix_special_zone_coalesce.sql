-- Fix Special Light feed runtime failure caused by schema-qualifying COALESCE.
-- COALESCE is SQL syntax and must not be resolved as pg_catalog.coalesce(...).

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260929091000'));

do $patch$
declare
  v_signature regprocedure := 'public.novelight_special_zone_feed_v1(text,text,text,integer,integer,text)'::regprocedure;
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(v_signature)
    into v_definition;

  if v_definition is null then
    raise exception 'Required Special Light feed function is missing';
  end if;

  if pg_catalog.strpos(v_definition, 'pg_catalog.coalesce') = 0 then
    return;
  end if;

  v_patched := pg_catalog.replace(
    v_definition,
    'pg_catalog.coalesce',
    'coalesce'
  );

  execute v_patched;

  if pg_catalog.strpos(pg_get_functiondef(v_signature), 'pg_catalog.coalesce') > 0 then
    raise exception 'Special Light feed COALESCE patch did not fully apply';
  end if;
end
$patch$;

commit;
