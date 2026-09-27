-- Harden the live LIGHT SEED v2 RPCs against NOVELIGHT special-light zones.
--
-- The public novel page calls light_seed_status_v2 / plant_light_seed_v2 directly,
-- so the v1 compatibility guards in 20260928004000_special_light_zones.sql are
-- not sufficient on their own. Keep this boundary server-side and fail closed
-- if the audited published-work predicate ever changes shape.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928004100'));

do $patch$
declare
  v_signature text;
  v_definition text;
  v_original text;
  v_patched boolean;
begin
  foreach v_signature in array array[
    'public.light_seed_status_v2(text)',
    'public.plant_light_seed_v2(text,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required LIGHT SEED v2 boundary function is missing: %', v_signature;
    end if;

    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_original := v_definition;
    v_patched := false;

    if pg_catalog.strpos(v_definition, 'n.status = ''published''') > 0 then
      v_definition := pg_catalog.replace(
        v_definition,
        'n.status = ''published''',
        'n.status = ''published'' and public.novelight_is_general_discovery_eligible(n.ai_usage, n.content_rating)'
      );
      v_patched := true;
    end if;

    if not v_patched or v_definition = v_original then
      raise exception 'Special-zone LIGHT SEED v2 exclusion anchor not found in %', v_signature;
    end if;

    if v_signature = 'public.plant_light_seed_v2(text,text)' then
      if pg_catalog.strpos(v_definition, 'Only published works can receive LIGHT SEED') = 0 then
        raise exception 'LIGHT SEED v2 rejection-message anchor not found';
      end if;

      v_definition := pg_catalog.replace(
        v_definition,
        'Only published works can receive LIGHT SEED',
        'This work is not eligible for LIGHT SEED'
      );
    end if;

    execute v_definition;
  end loop;
end
$patch$;

commit;
