-- NOVELIGHT beta audit: remove spoofable raw PV from authoritative ranking.
--
-- Anonymous raw PV remains an analytics/reference counter. Work Rank and the
-- public ranking use qualified valid-read events so rotating a client visitor
-- token cannot directly buy ranking position or Rank progression.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919165000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.beta_audit_rank_fairness_state (
  migration_id text primary key,
  applied_at timestamptz not null default now(),
  original_rank_recalculator text not null,
  original_ranking_feed text not null
);

insert into novelrise_migration_backup.beta_audit_rank_fairness_state (
  migration_id,
  original_rank_recalculator,
  original_ranking_feed
)
select
  '20260919165000',
  pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ),
  pg_get_functiondef(
    'public.novelight_ranking_feed(text,integer)'::regprocedure
  )
on conflict (migration_id) do nothing;

alter table public.novel_rank_state
  add column if not exists last_valid_read_count bigint
  check (last_valid_read_count is null or last_valid_read_count >= 0);

create or replace function public.novelight_rank_absolute_ceiling_v2(
  p_valid_read_count bigint,
  p_favorites bigint,
  p_rating_count bigint,
  p_rating_average numeric
)
returns smallint
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_valid_read_count, 0) >= 10000
     and coalesce(p_favorites, 0) >= 300
     and coalesce(p_rating_count, 0) >= 150
     and coalesce(p_rating_average, 0) >= 4.0 then 6
    when coalesce(p_valid_read_count, 0) >= 3000
     and coalesce(p_favorites, 0) >= 100
     and coalesce(p_rating_count, 0) >= 50
     and coalesce(p_rating_average, 0) >= 3.7 then 5
    when coalesce(p_valid_read_count, 0) >= 800
     and coalesce(p_favorites, 0) >= 30
     and coalesce(p_rating_count, 0) >= 15
     and coalesce(p_rating_average, 0) >= 3.5 then 4
    when coalesce(p_valid_read_count, 0) >= 200
     and coalesce(p_favorites, 0) >= 8
     and coalesce(p_rating_count, 0) >= 5
     and coalesce(p_rating_average, 0) >= 3.3 then 3
    when coalesce(p_valid_read_count, 0) >= 50
     and coalesce(p_favorites, 0) >= 2
     and coalesce(p_rating_count, 0) >= 2
     and coalesce(p_rating_average, 0) >= 3.0 then 2
    else 1
  end::smallint
$$;

revoke all on function public.novelight_rank_absolute_ceiling_v2(
  bigint, bigint, bigint, numeric
) from public, anon, authenticated;

create or replace function public.novelight_rank_internal_score_v2(
  p_valid_read_percentile double precision,
  p_favorite_percentile double precision,
  p_bayesian_rating_percentile double precision,
  p_rating_count_percentile double precision
)
returns double precision
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select
    (0.20::double precision * greatest(
      0::double precision,
      least(100::double precision, coalesce(p_valid_read_percentile, 0::double precision))
    ))
    + (0.35::double precision * greatest(
      0::double precision,
      least(100::double precision, coalesce(p_favorite_percentile, 0::double precision))
    ))
    + (
      0.45::double precision
      * (
        0.75::double precision * greatest(
          0::double precision,
          least(100::double precision, coalesce(p_bayesian_rating_percentile, 0::double precision))
        )
        + 0.25::double precision * greatest(
          0::double precision,
          least(100::double precision, coalesce(p_rating_count_percentile, 0::double precision))
        )
      )
    )
$$;

revoke all on function public.novelight_rank_internal_score_v2(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

do $patch$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  if v_definition is null
     or pg_catalog.strpos(v_definition, 'greatest(coalesce(n.pv, 0), 0)::bigint as pv') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_absolute_ceiling(') = 0
     or pg_catalog.strpos(v_definition, 'as pv_percentile') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_internal_score(') = 0 then
    raise exception 'Rank evaluator no longer matches the audited pre-fix contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'greatest(coalesce(n.pv, 0), 0)::bigint as pv,',
    'greatest(coalesce(n.pv, 0), 0)::bigint as pv,' || E'\n'
      || '             (select count(*)::bigint' || E'\n'
      || '                from public.valid_read_events vr' || E'\n'
      || '               where vr.novel_id_snapshot = n.id::text) as valid_read_count,'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'public.novelight_rank_absolute_ceiling(' || E'\n' || '               m.pv,',
    'public.novelight_rank_absolute_ceiling_v2(' || E'\n' || '               m.valid_read_count,'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    '(100.0::double precision * percent_rank() over (order by a.pv)) as pv_percentile,',
    '(100.0::double precision * percent_rank() over (order by a.valid_read_count)) as valid_read_percentile,'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'public.novelight_rank_internal_score(' || E'\n' || '               p.pv_percentile,',
    'public.novelight_rank_internal_score_v2(' || E'\n' || '               p.valid_read_percentile,'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'last_pv = v_row.pv,',
    'last_pv = v_row.pv,' || E'\n'
      || '             last_valid_read_count = v_row.valid_read_count,'
  );

  if v_definition = v_original
     or pg_catalog.strpos(v_definition, 'valid_read_count') = 0
     or pg_catalog.strpos(v_definition, 'valid_read_percentile') = 0
     or pg_catalog.strpos(v_definition, 'novelight_rank_absolute_ceiling_v2(') = 0
     or pg_catalog.strpos(v_definition, 'novelight_rank_internal_score_v2(') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_absolute_ceiling(') <> 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_internal_score(') <> 0 then
    raise exception 'Rank fairness patch did not produce the required valid-read contract';
  end if;

  execute v_definition;
end
$patch$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

create or replace function public.novelight_ranking_feed_v2(
  p_sort text default 'total',
  p_limit integer default 100
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  valid_read_count bigint,
  favorite_count bigint,
  score bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      (
        select count(*)::bigint
        from public.valid_read_events vr
        where vr.novel_id_snapshot = n.id::text
      ) as valid_read_count,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
      ) as favorite_count
    from public.novels n
    where n.status = 'published'
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.valid_read_count,
    c.favorite_count,
    (c.valid_read_count + c.favorite_count * 10)::bigint as score
  from candidates c
  order by
    case when p_sort = 'new' then c.created_at end desc nulls last,
    case when p_sort in ('reads', 'pv') then c.valid_read_count end desc nulls last,
    case when p_sort = 'favorites' then c.favorite_count end desc nulls last,
    case when p_sort not in ('new', 'reads', 'pv', 'favorites')
      then (c.valid_read_count + c.favorite_count * 10) end desc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.novelight_ranking_feed_v2(text, integer)
  from public;
grant execute on function public.novelight_ranking_feed_v2(text, integer)
  to anon, authenticated;

-- Fail closed on the legacy raw-PV ranking endpoint.
revoke execute on function public.novelight_ranking_feed(text, integer)
  from anon, authenticated;

commit;
