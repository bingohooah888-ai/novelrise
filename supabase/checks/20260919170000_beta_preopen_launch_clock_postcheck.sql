\set ON_ERROR_STOP on

do $$
declare
  v_signature text;
  v_definition text;
  v_seed_definition text;
begin
  if public.novelight_effective_publication_at(
       timestamptz '2026-09-28 10:00:00+09',
       timestamptz '2026-09-28 12:00:00+09'
     ) <> timestamptz '2026-09-30 00:00:00+09' then
    raise exception 'Preopen publication time is not clamped to beta launch';
  end if;

  if public.novelight_effective_publication_at(
       timestamptz '2026-10-02 10:00:00+09',
       timestamptz '2026-10-02 12:00:00+09'
     ) <> timestamptz '2026-10-02 12:00:00+09' then
    raise exception 'Post-launch publication time must remain real first publication';
  end if;

  foreach v_signature in array array[
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)',
    'public.novelight_neutral_search(text,text,text,integer,integer)',
    'public.record_novel_impressions_v2(text,text[],text)',
    'private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure)
      into v_definition;
    if pg_catalog.strpos(
         v_definition,
         'public.novelight_effective_publication_at('
       ) = 0 then
      raise exception 'Launch-clock helper is not wired into %', v_signature;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure
  ) into v_definition;
  -- The recommendation algorithm is plan-only from 2026-10-12 onward:
  -- it cannot activate or consume new-work boosts or exposure debt.
  -- Preserve the old launch-clock assertion for prior schema versions.
  if pg_catalog.strpos(v_definition, '4503599627370496::numeric') > 0 then
    if pg_catalog.strpos(v_definition, 'premium_new_work_boost') <> 0
       or pg_catalog.strpos(v_definition, 'normalized_author_exposure') <> 0
       or pg_catalog.strpos(v_definition, 'novel_exposure_events') <> 0 then
      raise exception 'Plan-only recommendations must not use preopen exposure';
    end if;
  elsif pg_catalog.strpos(v_definition, 'effective_publication_at <= now()') = 0
     or pg_catalog.strpos(
       v_definition,
       'e.exposed_at >= b.effective_publication_at'
     ) = 0 then
    raise exception 'Preopen exposure must not activate or consume launch benefits';
  end if;

  select pg_get_functiondef(
    'private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, ') <= now()') = 0
     or pg_catalog.strpos(
       v_definition,
       'e.exposed_at >= public.novelight_effective_publication_at('
     ) = 0 then
    raise exception 'Trusted receipt attribution must start at effective publication';
  end if;

  select pg_get_functiondef(
    'public.novelight_neutral_search(text,text,text,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'case when p_sort = ''new'' then c.effective_publication_at'
     ) = 0
     or pg_catalog.strpos(v_definition, 'c.created_at desc') = 0 then
    raise exception 'New-arrival ordering must use launch clock with real-time tie-break';
  end if;

  select pg_get_functiondef(
    'public.novelight_light_seed_feed(integer,integer)'::regprocedure
  ) into v_seed_definition;
  if pg_catalog.strpos(
       v_seed_definition,
       'public.novelight_effective_publication_at('
     ) <> 0 then
    raise exception 'LIGHT SEED shelf ordering must preserve real publication time';
  end if;
end
$$;
