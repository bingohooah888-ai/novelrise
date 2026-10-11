-- Merge R15 works into general discovery without changing any work records.
-- R18 is isolated; AI-generated R15 works stay in the AI discovery zone.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20261012010000:r15-general'));

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
    when p_ai_usage = 'ai_generated' then 'ai'
    else 'general'
  end
$$;

-- Do not broaden LIGHT SEED while broadening ordinary discovery.
create or replace function public.novelight_is_light_seed_eligible(
  p_ai_usage text,
  p_content_rating text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_content_rating = 'general'
    and coalesce(p_ai_usage, '') <> 'ai_generated'
$$;

revoke all on function public.novelight_is_light_seed_eligible(text, text)
  from public, anon, authenticated;
grant execute on function public.novelight_is_light_seed_eligible(text, text)
  to anon, authenticated;

-- Existing SEED RPCs were guarded by general-discovery eligibility.
-- Replace their gate with the narrower one; fail if a guard has drifted.
do $patch$
declare
  v_signature text;
  v_definition text;
  v_guard text := 'public.novelight_is_general_discovery_eligible(';
begin
  foreach v_signature in array array[
    'public.novelight_light_seed_feed(integer,integer)',
    'public.light_seed_status_auto_v1(text)',
    'public.plant_light_seed_auto_v1(text)',
    'public.light_seed_status_v2(text)',
    'public.plant_light_seed_v2(text,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'R15 migration: required LIGHT SEED RPC missing: %', v_signature;
    end if;
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if pg_catalog.strpos(v_definition, v_guard) = 0 then
      raise exception 'R15 migration: LIGHT SEED guard changed: %', v_signature;
    end if;
    execute pg_catalog.replace(
      v_definition, v_guard, 'public.novelight_is_light_seed_eligible('
    );
  end loop;
end
$patch$;

do $verify$
begin
  if public.novelight_discovery_zone('human', 'sensitive_15') <> 'general'
     or public.novelight_discovery_zone('ai_assisted', 'sensitive_15') <> 'general'
     or public.novelight_discovery_zone('ai_generated', 'sensitive_15') <> 'ai'
     or public.novelight_discovery_zone('human', 'adult_18_nonsexual') <> 'r18'
     or public.novelight_is_light_seed_eligible('human', 'sensitive_15')
     or public.novelight_is_light_seed_eligible('ai_generated', 'general')
     or not public.novelight_is_light_seed_eligible('human', 'general') then
    raise exception 'R15 discovery/SEED invariants failed';
  end if;
end
$verify$;

commit;
