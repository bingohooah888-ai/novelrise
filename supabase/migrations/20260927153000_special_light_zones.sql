-- NOVELIGHT special-light discovery zones.
-- Keep AI-generated / R15 / R18 works public and discoverable without mixing
-- them into ordinary home discovery, new-arrival, Rank, LIGHT SEED, or paid
-- exposure surfaces. Zone precedence is R18 > R15 > AI > general.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260927153000-special-light-zones'));

create or replace function public.novelight_discovery_zone(
  p_ai_usage text,
  p_content_rating text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_content_rating, 'general') = 'adult_18_nonsexual' then 'r18'
    when coalesce(p_content_rating, 'general') = 'sensitive_15' then 'r15'
    when coalesce(p_content_rating, 'general') = 'general'
      and coalesce(p_ai_usage, 'unspecified') = 'ai_generated' then 'ai'
    when coalesce(p_content_rating, 'general') = 'general'
      and coalesce(p_ai_usage, 'unspecified') in ('human', 'ai_assisted') then 'general'
    else 'restricted'
  end
$$;

create or replace function public.novelight_is_general_discovery_work(
  p_ai_usage text,
  p_content_rating text
)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select public.novelight_discovery_zone(p_ai_usage, p_content_rating) = 'general'
$$;

revoke all on function public.novelight_discovery_zone(text, text)
  from public, anon, authenticated;
revoke all on function public.novelight_is_general_discovery_work(text, text)
  from public, anon, authenticated;
grant execute on function public.novelight_discovery_zone(text, text)
  to anon, authenticated;
grant execute on function public.novelight_is_general_discovery_work(text, text)
  to anon, authenticated;

-- Patch authoritative normal-discovery RPCs in place so every existing client,
-- including trusted/legacy fallbacks, inherits the same server-side boundary.
do $patch$
declare
  v_signature text;
  v_definition text;
  v_original text;
  v_target text;
  v_replacement text;
begin
  foreach v_signature in array array[
    'public.novelight_neutral_search(text,text,text,integer,integer)',
    'public.novelight_neutral_search_v2(text,text,text[],text,integer,integer)',
    'public.novelight_ranking_feed(text,integer)',
    'public.novelight_ranking_feed_v2(text,integer)',
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)',
    'public.novelight_plan_extra_feed(integer,text[],text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      if v_signature in (
        'public.novelight_neutral_search_v2(text,text,text[],text,integer,integer)',
        'public.novelight_ranking_feed_v2(text,integer)'
      ) then
        continue;
      end if;
      raise exception 'Required normal discovery function is missing: %', v_signature;
    end if;

    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_original := v_definition;
    v_target := 'where n.status = ''published''';
    v_replacement := v_target || E'\n      and public.novelight_is_general_discovery_work(n.ai_usage, n.content_rating)';

    if pg_catalog.strpos(v_definition, v_replacement) > 0 then
      continue;
    end if;
    if pg_catalog.strpos(v_definition, v_target) = 0 then
      raise exception 'Normal discovery function no longer matches zoning patch contract: %', v_signature;
    end if;

    v_definition := pg_catalog.replace(v_definition, v_target, v_replacement);
    if v_definition = v_original then
      raise exception 'Failed to apply normal discovery zoning to %', v_signature;
    end if;
    execute v_definition;
  end loop;

  foreach v_signature in array array[
    'public.novelight_light_seed_feed(integer,integer)',
    'public.novelight_beta_rank_discovery_feed(text,integer,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required shelf function is missing: %', v_signature;
    end if;
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_original := v_definition;
    v_target := 'where novel.status = ''published''';
    v_replacement := v_target || E'\n      and public.novelight_is_general_discovery_work(novel.ai_usage, novel.content_rating)';
    if pg_catalog.strpos(v_definition, v_replacement) > 0 then
      continue;
    end if;
    if pg_catalog.strpos(v_definition, v_target) = 0 then
      raise exception 'Shelf function no longer matches zoning patch contract: %', v_signature;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_target, v_replacement);
    if v_definition = v_original then
      raise exception 'Failed to apply shelf zoning to %', v_signature;
    end if;
    execute v_definition;
  end loop;
end
$patch$;

-- LIGHT SEED is never available in special-light zones. Both status and
-- mutation paths enforce this server-side so a hidden/forged client cannot send.
do $seed_patch$
declare
  v_definition text;
  v_original text;
  v_guard text := E'\n  if exists (\n    select 1\n    from public.novels zone_novel\n    where zone_novel.id::text = p_novel_id\n      and zone_novel.status = ''published''\n      and not public.novelight_is_general_discovery_work(zone_novel.ai_usage, zone_novel.content_rating)\n  ) then\n    return pg_catalog.jsonb_build_object(\n      ''eligible'', false,\n      ''can_plant'', false,\n      ''reason'', ''special_light_zone'',\n      ''monthly_limit'', 11,\n      ''remaining_this_month'', 0,\n      ''total_seed_count'', 0,\n      ''rule_version'', ''beta-auto-v1''\n    );\n  end if;\n';
  v_mutation_guard text := E'\n  if exists (\n    select 1\n    from public.novels zone_novel\n    where zone_novel.id::text = p_novel_id\n      and zone_novel.status = ''published''\n      and not public.novelight_is_general_discovery_work(zone_novel.ai_usage, zone_novel.content_rating)\n  ) then\n    raise exception using errcode = ''23514'', message = ''SPECIAL_LIGHT_ZONE_LIGHT_SEED_DISABLED'';\n  end if;\n';
begin
  if to_regprocedure('public.light_seed_status_auto_v1(text)') is null
     or to_regprocedure('public.plant_light_seed_auto_v1(text)') is null then
    raise exception 'Current automatic LIGHT SEED functions are required';
  end if;

  select pg_get_functiondef('public.light_seed_status_auto_v1(text)'::regprocedure)
    into v_definition;
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, '''reason'', ''special_light_zone''') = 0 then
    if pg_catalog.strpos(v_definition, '  select n.user_id into v_author_id') = 0 then
      raise exception 'LIGHT SEED status function no longer matches zoning patch contract';
    end if;
    v_definition := pg_catalog.replace(
      v_definition,
      '  select n.user_id into v_author_id',
      v_guard || E'\n  select n.user_id into v_author_id'
    );
    if v_definition = v_original then
      raise exception 'Failed to zone LIGHT SEED status';
    end if;
    execute v_definition;
  end if;

  select pg_get_functiondef('public.plant_light_seed_auto_v1(text)'::regprocedure)
    into v_definition;
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, 'SPECIAL_LIGHT_ZONE_LIGHT_SEED_DISABLED') = 0 then
    if pg_catalog.strpos(v_definition, '  select n.user_id, coalesce(n.pv, 0)::bigint') = 0 then
      raise exception 'LIGHT SEED mutation function no longer matches zoning patch contract';
    end if;
    v_definition := pg_catalog.replace(
      v_definition,
      '  select n.user_id, coalesce(n.pv, 0)::bigint',
      v_mutation_guard || E'\n  select n.user_id, coalesce(n.pv, 0)::bigint'
    );
    if v_definition = v_original then
      raise exception 'Failed to zone LIGHT SEED mutation';
    end if;
    execute v_definition;
  end if;
end
$seed_patch$;

-- Special-zone search/recommendation/ranking. The zone is separate from genre.
-- Recommendation is deterministic-per-viewer/time-bucket rotation rather than
-- ORDER BY random(), with one-work-per-author fairness ahead of repeats.
create or replace function public.novelight_special_light_feed(
  p_zone text,
  p_mode text default 'recommended',
  p_keyword text default null,
  p_genre text default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_rotation_key text default null
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  author_id uuid,
  author_name text,
  thumbnail_url text,
  favorite_count bigint,
  rating_count bigint,
  rating_average numeric,
  valid_read_count bigint,
  ranking_score numeric,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_zone, ''))) as zone,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_mode, 'recommended'))) as mode,
      pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_rotation_key), ''), 'public'), 128) as rotation_key
  ),
  favorite_metric as (
    select f.novel_id::text as novel_id_snapshot,
           count(distinct f.user_id)::bigint as favorite_count
      from public.favorites f
      join public.novels owner_novel on owner_novel.id = f.novel_id
     where f.user_id <> owner_novel.user_id
     group by f.novel_id::text
  ),
  rating_metric as (
    select r.novel_id_snapshot,
           count(*)::bigint as rating_count,
           pg_catalog.round(avg(r.rating)::numeric, 2) as rating_average
      from public.novel_star_ratings r
     group by r.novel_id_snapshot
  ),
  read_metric as (
    select r.novel_id_snapshot,
           count(distinct r.reader_id)::bigint as valid_read_count
      from public.valid_read_events r
     where r.foreground_signal
       and (r.progress_signal or r.interaction_signal)
     group by r.novel_id_snapshot
  ),
  base as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      n.user_id as author_id,
      coalesce(profile.display_name, '')::text as author_name,
      n.thumbnail_url,
      coalesce(f.favorite_count, 0)::bigint as favorite_count,
      coalesce(r.rating_count, 0)::bigint as rating_count,
      r.rating_average,
      coalesce(v.valid_read_count, 0)::bigint as valid_read_count,
      (
        coalesce(f.favorite_count, 0)::numeric * 20
        + coalesce(v.valid_read_count, 0)::numeric * 8
        + coalesce(r.rating_count, 0)::numeric * 5
        + coalesce(r.rating_average, 0)::numeric * 10
      ) as ranking_score,
      pg_catalog.md5(
        params.rotation_key || ':' || params.zone || ':' ||
        pg_catalog.date_trunc('hour', pg_catalog.now())::text || ':' || n.id::text
      ) as rotation_key
    from public.novels n
    cross join params
    left join public.profiles profile on profile.id = n.user_id
    left join favorite_metric f on f.novel_id_snapshot = n.id::text
    left join rating_metric r on r.novel_id_snapshot = n.id::text
    left join read_metric v on v.novel_id_snapshot = n.id::text
    where n.status = 'published'
      and params.zone in ('ai', 'r15', 'r18')
      and public.novelight_discovery_zone(n.ai_usage, n.content_rating) = params.zone
      and (
        nullif(pg_catalog.btrim(coalesce(p_keyword, '')), '') is null
        or coalesce(n.title, '') ilike '%' || pg_catalog.btrim(p_keyword) || '%'
        or coalesce(n.description, '') ilike '%' || pg_catalog.btrim(p_keyword) || '%'
      )
      and (
        nullif(pg_catalog.btrim(coalesce(p_genre, '')), '') is null
        or n.genre = pg_catalog.btrim(p_genre)
      )
  ),
  fair as (
    select b.*,
      row_number() over (
        partition by b.author_id
        order by b.rotation_key, b.created_at desc, b.novel_id
      ) as author_rotation_rank
    from base b
  ),
  counted as (
    select f.*, count(*) over ()::bigint as total_count
    from fair f
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.pv,
    c.author_id,
    c.author_name,
    c.thumbnail_url,
    c.favorite_count,
    c.rating_count,
    c.rating_average,
    c.valid_read_count,
    c.ranking_score,
    c.total_count
  from counted c
  cross join params
  order by
    case when params.mode = 'ranking' then c.ranking_score end desc nulls last,
    case when params.mode = 'ranking' then c.rating_count end desc nulls last,
    case when params.mode = 'ranking' then c.favorite_count end desc nulls last,
    case when params.mode <> 'ranking' then c.author_rotation_rank end asc nulls last,
    case when params.mode <> 'ranking' then c.rotation_key end asc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.novelight_special_light_genres(p_zone text)
returns table (genre text, work_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select n.genre, count(*)::bigint as work_count
  from public.novels n
  where n.status = 'published'
    and public.novelight_discovery_zone(n.ai_usage, n.content_rating)
      = pg_catalog.lower(pg_catalog.btrim(coalesce(p_zone, '')))
    and pg_catalog.lower(pg_catalog.btrim(coalesce(p_zone, ''))) in ('ai', 'r15', 'r18')
  group by n.genre
  order by count(*) desc, n.genre asc
$$;

revoke all on function public.novelight_special_light_feed(text,text,text,text,integer,integer,text)
  from public;
revoke all on function public.novelight_special_light_genres(text) from public;
grant execute on function public.novelight_special_light_feed(text,text,text,text,integer,integer,text)
  to anon, authenticated;
grant execute on function public.novelight_special_light_genres(text)
  to anon, authenticated;

comment on function public.novelight_discovery_zone(text, text) is
  'Canonical discovery zoning: R18 > R15 > AI-generated-general > general human/AI-assisted.';
comment on function public.novelight_special_light_feed(text,text,text,text,integer,integer,text) is
  'Dedicated AI/R15/R18 discovery feed. LIGHT SEED and paid exposure are intentionally excluded.';

commit;
