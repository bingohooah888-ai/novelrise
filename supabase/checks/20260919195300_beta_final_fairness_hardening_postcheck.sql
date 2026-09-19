\set ON_ERROR_STOP on

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.novelight_can_favorite_novel(bigint)') is null then
    raise exception 'Self-favorite guard helper is missing';
  end if;

  if to_regprocedure(
       'public.novelight_exposure_balance_start(timestamp with time zone)'
     ) is null then
    raise exception 'Launch exposure-balance helper is missing';
  end if;

  if public.novelight_exposure_balance_start(
       timestamptz '2026-09-30 12:00:00+09'
     ) <> timestamptz '2026-09-30 00:00:00+09'
     or public.novelight_exposure_balance_start(
       timestamptz '2026-10-08 12:00:00+09'
     ) <> timestamptz '2026-10-01 12:00:00+09' then
    raise exception 'Launch exposure-balance boundary is incorrect';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.novelight_can_favorite_novel(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_can_favorite_novel(bigint)',
       'EXECUTE'
     ) then
    raise exception 'Self-favorite helper privileges are incorrect';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'favorites'
      and p.policyname = 'Users can add own favorites'
      and pg_catalog.strpos(
        coalesce(p.with_check, ''),
        'novelight_can_favorite_novel'
      ) > 0
  ) then
    raise exception 'Favorite INSERT policy is not owner-safe';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'favorites'
      and indexname = 'favorites_novel_id_user_id_idx'
  ) then
    raise exception 'Favorite aggregation index is missing';
  end if;

  select pg_get_functiondef(
    'public.record_valid_read_progress(text,uuid,double precision,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'if v_foreground_signal and (v_progress_signal or v_interaction_signal) then'
     ) = 0
     or pg_catalog.strpos(v_definition, 'if v_signal_count >= 2 then') <> 0 then
    raise exception 'Valid-read foreground requirement is missing';
  end if;
  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'count(distinct vr.reader_id)::bigint') = 0
     or pg_catalog.strpos(v_definition, 'and vr.foreground_signal') = 0
     or pg_catalog.strpos(v_definition, 'where f.user_id <> fn.user_id') = 0 then
    raise exception 'Work Rank is not using unique hardened readers/self-safe favorites';
  end if;

  select pg_get_functiondef(
    'public.novelight_ranking_feed_v2(text,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'count(distinct vr.reader_id)::bigint') = 0
     or pg_catalog.strpos(v_definition, 'and vr.foreground_signal') = 0
     or pg_catalog.strpos(v_definition, 'and f.user_id <> n.user_id') = 0 then
    raise exception 'Public ranking is not using hardened fairness signals';
  end if;

  select pg_get_functiondef(
    'public.novelight_favorite_count(text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'select n.user_id from public.novels n') = 0 then
    raise exception 'Public favorite count does not exclude self-favorites';
  end if;

  select pg_get_functiondef(
    'public.novelight_neutral_search(text,text,text,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'case when p_sort = ''pv'' then c.pv end'
     ) <> 0
     or pg_catalog.strpos(v_definition, 'and f.user_id <> n.user_id') = 0 then
    raise exception 'Neutral search still exposes a fairness bypass';
  end if;

  select pg_get_functiondef(
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'public.novelight_exposure_balance_start(now())'
     ) = 0
     or pg_catalog.strpos(v_definition, 'and f.user_id <> n.user_id') = 0 then
    raise exception 'Discovery feed still exposes a fairness bypass';
  end if;

  select pg_get_functiondef(
    'public.light_seed_status_v2(text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'and r.foreground_signal') = 0 then
    raise exception 'LIGHT SEED status accepts legacy weak valid-read rows';
  end if;

  select pg_get_functiondef(
    'public.plant_light_seed_v2(text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'and r.foreground_signal') = 0
     or pg_catalog.strpos(v_definition, 'and f.user_id <> v_author_id') = 0 then
    raise exception 'LIGHT SEED send path is not hardened';
  end if;
end
$$;
