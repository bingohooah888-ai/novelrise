-- Roll back the R15 discovery merge without touching novel records.
begin;
select pg_advisory_xact_lock(hashtext('novelight:20261012010000:r15-general'));

do $patch$
declare
  v_signature text;
  v_definition text;
  v_guard text := 'public.novelight_is_light_seed_eligible(';
begin
  foreach v_signature in array array[
    'public.novelight_light_seed_feed(integer,integer)',
    'public.light_seed_status_auto_v1(text)',
    'public.plant_light_seed_auto_v1(text)',
    'public.light_seed_status_v2(text)',
    'public.plant_light_seed_v2(text,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'R15 rollback: LIGHT SEED RPC missing: %', v_signature;
    end if;
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if pg_catalog.strpos(v_definition, v_guard) = 0 then
      raise exception 'R15 rollback: LIGHT SEED guard drifted: %', v_signature;
    end if;
    execute pg_catalog.replace(
      v_definition, v_guard, 'public.novelight_is_general_discovery_eligible('
    );
  end loop;
end
$patch$;

create or replace function public.novelight_discovery_zone(
  p_ai_usage text,
  p_content_rating text
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_content_rating = 'adult_18_nonsexual' then 'r18'
    when p_content_rating = 'sensitive_15' then 'r15'
    when p_ai_usage = 'ai_generated' then 'ai'
    else 'general'
  end
$$;

drop function public.novelight_is_light_seed_eligible(text, text);
commit;
