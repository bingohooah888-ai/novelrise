-- Roll back R15+general parity: restore historical category quotas and original SEED restriction.
-- This preserves the exact viewport-size receipt issuance and the exposure
-- ordering within each content-rating group. AI-generated and R18 remain excluded.
begin;

do $seed_prev_guard$
begin
  if strpos(pg_get_functiondef('public.novelight_is_light_seed_eligible(text,text)'::regprocedure), 'p_content_rating in (''general'', ''sensitive_15'')') = 0 then
    raise exception 'R15 seed parity rollback: unexpected eligibility predicate';
  end if;
end
$seed_prev_guard$;

create or replace function public.novelight_is_light_seed_eligible(
  p_ai_usage text,
  p_content_rating text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $
  select p_content_rating = 'general'
    and coalesce(p_ai_usage, '') <> 'ai_generated'
$;
do $novelight_r15_balance$
declare
  v_function regprocedure := to_regprocedure('public.novelight_discovery_feed_v2(text,integer,text,text,text)');
  v_definition text;
begin
  if v_function is null then
    raise exception 'R15 recommendation balance: expected discovery feed is missing';
  end if;
  v_definition := pg_get_functiondef(v_function);
  if strpos(v_definition, $old_base$      n.created_at,
      public.novelight_effective_publication_at($old_base$) = 0
    or strpos(v_definition, $old_order$  ordered_general as materialized (
    select
      row_number() over (
        order by
          r.recently_seen asc,
          r.needs_initial_exposure desc,
          r.author_work_rank asc,
          r.normalized_author_exposure asc,
          r.normalized_novel_exposure asc,
          r.tie_breaker
      )::integer as feed_position,
      r.*
    from ranked r
  ),$old_order$) = 0
    or strpos(v_definition, 'rating_ranked as materialized') <> 0 then
    raise exception 'R15 recommendation balance: unexpected prior discovery definition';
  end if;
  v_definition := replace(
    v_definition,
    $old_base$      n.created_at,
      public.novelight_effective_publication_at($old_base$,
    $new_base$      n.created_at,
      n.content_rating,
      public.novelight_effective_publication_at($new_base$
  );
  v_definition := replace(
    v_definition,
    $old_order$  ordered_general as materialized (
    select
      row_number() over (
        order by
          r.recently_seen asc,
          r.needs_initial_exposure desc,
          r.author_work_rank asc,
          r.normalized_author_exposure asc,
          r.normalized_novel_exposure asc,
          r.tie_breaker
      )::integer as feed_position,
      r.*
    from ranked r
  ),$old_order$,
    $new_order$  rating_ranked as materialized (
    select
      r.*,
      row_number() over (
        partition by (r.content_rating = 'sensitive_15')
        order by
          r.recently_seen asc,
          r.needs_initial_exposure desc,
          r.author_work_rank asc,
          r.normalized_author_exposure asc,
          r.normalized_novel_exposure asc,
          r.tie_breaker
      ) as rating_rank
    from ranked r
  ),
  ordered_general as materialized (
    select
      row_number() over (
        order by
          case
            when r.content_rating = 'sensitive_15' then
              r.rating_rank * 3 - 2
            else
              r.rating_rank + 1 + (r.rating_rank - 1) / 2
          end asc,
          r.tie_breaker
      )::integer as feed_position,
      r.*
    from rating_ranked r
  ),$new_order$
  );
  execute v_definition;
  if strpos(pg_get_functiondef(v_function), 'rating_ranked as materialized') = 0 then
    raise exception 'R15 recommendation balance: expected SQL patch was not applied';
  end if;
end
$novelight_r15_balance$;
commit;
