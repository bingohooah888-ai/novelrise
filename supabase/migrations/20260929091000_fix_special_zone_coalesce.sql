-- Fix Special Light feed runtime failures caused by schema-qualifying SQL
-- conditional expressions that are syntax constructs rather than pg_catalog
-- functions: COALESCE, GREATEST, LEAST, and NULLIF.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260929091000'));

do $patch$
declare
  v_signature regprocedure := 'public.novelight_special_zone_feed_v1(text,text,text,integer,integer,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_invalid text;
begin
  select pg_get_functiondef(v_signature)
    into v_definition;

  if v_definition is null then
    raise exception 'Required Special Light feed function is missing';
  end if;

  v_patched := v_definition;

  foreach v_invalid in array array[
    'pg_catalog.coalesce',
    'pg_catalog.greatest',
    'pg_catalog.least',
    'pg_catalog.nullif'
  ] loop
    v_patched := pg_catalog.replace(
      v_patched,
      v_invalid,
      pg_catalog.replace(v_invalid, 'pg_catalog.', '')
    );
  end loop;

  if v_patched = v_definition then
    return;
  end if;

  execute v_patched;

  foreach v_invalid in array array[
    'pg_catalog.coalesce',
    'pg_catalog.greatest',
    'pg_catalog.least',
    'pg_catalog.nullif'
  ] loop
    if pg_catalog.strpos(pg_get_functiondef(v_signature), v_invalid) > 0 then
      raise exception 'Special Light feed SQL-expression patch did not fully apply: %', v_invalid;
    end if;
  end loop;
end
$patch$;

commit;
