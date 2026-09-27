-- NOVELIGHT special-light discovery zones.
--
-- Canonical zoning precedence:
--   R18 > R15 > AI-generated > general
-- AI-assisted general works remain in ordinary discovery.
-- Special-zone works keep ordinary reader interactions, but are excluded from
-- ordinary discovery surfaces, ordinary ranking, Premium extra exposure, and
-- LIGHT SEED. Each zone receives its own recommendation/ranking feed.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928004000'));

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

revoke all on function public.novelight_discovery_zone(text, text)
  from public, anon, authenticated;
grant execute on function public.novelight_discovery_zone(text, text)
  to anon, authenticated;

create or replace function public.novelight_is_general_discovery_eligible(
  p_ai_usage text,
  p_content_rating text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select public.novelight_discovery_zone(p_ai_usage, p_content_rating) = 'general'
$$;

revoke all on function public.novelight_is_general_discovery_eligible(text, text)
  from public, anon, authenticated;
grant execute on function public.novelight_is_general_discovery_eligible(text, text)
  to anon, authenticated;

-- Harden every ordinary discovery path at the server boundary. The patch is
-- fail-closed: if an audited function no longer has a published-novel predicate,
-- deployment stops instead of silently leaking a special-zone work.
do $patch$
declare
  v_signature text;
  v_definition text;
  v_original text;
  v_patched boolean;
begin
  foreach v_signature in array array[
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)',
    'public.novelight_plan_extra_feed(integer,text[],text)',
    'public.novelight_neutral_search(text,text,text,integer,integer)',
    'public.novelight_light_seed_feed(integer,integer)',
    'public.novelight_beta_rank_discovery_feed(text,integer,text)',
    'public.novelight_ranking_feed_v2(text,integer)',
    'public.light_seed_status_auto_v1(text)',
    'public.plant_light_seed_auto_v1(text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required special-zone boundary function is missing: %', v_signature;
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

    if pg_catalog.strpos(v_definition, 'novel.status = ''published''') > 0 then
      v_definition := pg_catalog.replace(
        v_definition,
        'novel.status = ''published''',
        'novel.status = ''published'' and public.novelight_is_general_discovery_eligible(novel.ai_usage, novel.content_rating)'
      );
      v_patched := true;
    end if;

    if not v_patched or v_definition = v_original then
      raise exception 'Special-zone exclusion anchor not found in %', v_signature;
    end if;

    if v_signature = 'public.plant_light_seed_auto_v1(text)' then
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

create or replace function public.novelight_special_zone_feed_v1(
  p_zone text,
  p_mode text default 'recommended',
  p_genre text default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_rotation_key text default null
)
returns table (
  feed_position integer,
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  author_id uuid,
  author_name text,
  thumbnail_url text,
  favorite_count bigint,
  rating_count bigint,
  average_rating numeric,
  qualified_reader_count bigint,
  zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_zone, '')));
  v_mode text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_mode, 'recommended')));
  v_limit integer := pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit, 24), 1), 48);
  v_offset integer := pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_offset, 0), 0), 10000);
  v_rotation text := pg_catalog.left(
    pg_catalog.coalesce(
      pg_catalog.nullif(pg_catalog.btrim(p_rotation_key), ''),
      pg_catalog.date_trunc('hour', pg_catalog.now())::text
    ),
    128
  );
begin
  if v_zone not in ('ai', 'r15', 'r18') then
    raise exception using errcode = '22023', message = 'Unknown special-light zone';
  end if;

  if v_mode not in ('recommended', 'ranking') then
    raise exception using errcode = '22023', message = 'Unknown special-light display mode';
  end if;

  return query
  with metrics as materialized (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      n.user_id as author_id,
      pg_catalog.coalesce(p.display_name, '')::text as author_name,
      n.thumbnail_url,
      (pg_catalog.count(distinct f.user_id) filter (where f.user_id <> n.user_id))::bigint as favorite_count,
      (pg_catalog.count(distinct r.user_id) filter (where r.user_id <> n.user_id))::bigint as rating_count,
      pg_catalog.round(
        (pg_catalog.avg(r.rating) filter (where r.user_id <> n.user_id))::numeric,
        2
      ) as average_rating,
      (
        pg_catalog.count(distinct vr.reader_id) filter (
          where vr.reader_id <> n.user_id
            and vr.foreground_signal
            and (vr.progress_signal or vr.interaction_signal)
        )
      )::bigint as qualified_reader_count,
      public.novelight_discovery_zone(n.ai_usage, n.content_rating) as zone,
      pg_catalog.md5(v_rotation || ':' || n.id::text) as rotation_key
    from public.novels n
    left join public.profiles p on p.id = n.user_id
    left join public.favorites f on f.novel_id::text = n.id::text
    left join public.novel_star_ratings r on r.novel_id_snapshot = n.id::text
    left join public.valid_read_events vr on vr.novel_id_snapshot = n.id::text
    where n.status = 'published'
      and public.novelight_discovery_zone(n.ai_usage, n.content_rating) = v_zone
      and (
        p_genre is null
        or pg_catalog.btrim(p_genre) = ''
        or n.genre = pg_catalog.btrim(p_genre)
      )
    group by
      n.id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      n.user_id,
      p.display_name,
      n.thumbnail_url,
      n.ai_usage,
      n.content_rating
  ),
  scored as materialized (
    select
      m.*,
      (
        (
          (
            pg_catalog.coalesce(m.rating_count, 0)::numeric
            * pg_catalog.coalesce(m.average_rating, 0)::numeric
          ) + (10::numeric * 3.0::numeric)
        ) / (pg_catalog.coalesce(m.rating_count, 0)::numeric + 10::numeric)
      )
      + (pg_catalog.ln(1 + pg_catalog.coalesce(m.favorite_count, 0)) * 0.28)
      + (pg_catalog.ln(1 + pg_catalog.coalesce(m.qualified_reader_count, 0)) * 0.22)
      + (pg_catalog.ln(1 + pg_catalog.coalesce(m.rating_count, 0)) * 0.12) as ranking_score,
      pg_catalog.row_number() over (
        partition by m.author_id
        order by m.rotation_key, m.created_at desc, m.novel_id
      ) as author_rotation_position
    from metrics m
  ),
  ordered as (
    select
      s.*,
      pg_catalog.row_number() over (
        order by
          case when v_mode = 'recommended' then s.author_rotation_position else 1 end asc,
          case when v_mode = 'ranking' then s.ranking_score end desc nulls last,
          case when v_mode = 'ranking' then s.qualified_reader_count end desc nulls last,
          case when v_mode = 'ranking' then s.favorite_count end desc nulls last,
          case when v_mode = 'recommended' then s.rotation_key end asc nulls last,
          s.created_at desc,
          s.novel_id
      )::integer as feed_position
    from scored s
  )
  select
    o.feed_position,
    o.novel_id,
    o.title,
    o.genre,
    o.description,
    o.created_at,
    o.author_id,
    o.author_name,
    o.thumbnail_url,
    o.favorite_count,
    o.rating_count,
    o.average_rating,
    o.qualified_reader_count,
    o.zone
  from ordered o
  where o.feed_position > v_offset
    and o.feed_position <= v_offset + v_limit
  order by o.feed_position;
end
$$;

revoke all on function public.novelight_special_zone_feed_v1(text,text,text,integer,integer,text)
  from public;
grant execute on function public.novelight_special_zone_feed_v1(text,text,text,integer,integer,text)
  to anon, authenticated;

commit;
