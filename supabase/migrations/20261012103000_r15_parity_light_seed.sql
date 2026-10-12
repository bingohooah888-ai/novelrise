-- Equal eligibility for R15/general in existing recommendation allocator;
-- enable R15 LIGHT SEED without changing the existing read/send safeguards.
begin;
do $novelight_r15_balance_rollback$
declare
  v_function regprocedure := to_regprocedure('public.novelight_discovery_feed_v2(text,integer,text,text,text)');
  v_definition text;
begin
  if v_function is null then
    raise exception 'R15 recommendation rollback: expected discovery feed is missing';
  end if;
  v_definition := pg_get_functiondef(v_function);
  if strpos(v_definition, $new_base$      n.created_at,
      n.content_rating,
      public.novelight_effective_publication_at($new_base$) = 0
    or strpos(v_definition, $new_order$  rating_ranked as materialized (
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
  ),$new_order$) = 0 then
    raise exception 'R15 recommendation rollback: unexpected current discovery definition';
  end if;
  v_definition := replace(
    v_definition,
    $new_base$      n.created_at,
      n.content_rating,
      public.novelight_effective_publication_at($new_base$,
    $old_base$      n.created_at,
      public.novelight_effective_publication_at($old_base$
  );
  v_definition := replace(
    v_definition,
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
  ),$new_order$,
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
  ),$old_order$
  );
  execute v_definition;
end
$novelight_r15_balance_rollback$;

-- Assert all five authoritative SEED entry points still honor the shared gate.
do $r15_seed_verify$
declare
  v_signature text;
begin
  if to_regprocedure('public.novelight_is_light_seed_eligible(text,text)') is null
     or strpos(pg_get_functiondef('public.novelight_is_light_seed_eligible(text,text)'::regprocedure), 'p_content_rating = ''general''') = 0 then
    raise exception 'R15 seed parity: unexpected existing eligibility predicate';
  end if;
  foreach v_signature in array array[
    'public.novelight_light_seed_feed(integer,integer)',
    'public.light_seed_status_auto_v1(text)',
    'public.plant_light_seed_auto_v1(text)',
    'public.light_seed_status_v2(text)',
    'public.plant_light_seed_v2(text,text)'
  ] loop
    if to_regprocedure(v_signature) is null
      or strpos(pg_get_functiondef(v_signature::regprocedure), 'public.novelight_is_light_seed_eligible(') = 0 then
      raise exception 'R15 seed parity: required guarded RPC changed: %', v_signature;
    end if;
  end loop;
end
$r15_seed_verify$;

-- The content rating does not change chances to receive a SEED;
-- the existing anti-abuse, valid-read and monthly inventory rules still apply.
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
  select p_content_rating in ('general', 'sensitive_15')
    and coalesce(p_ai_usage, '') <> 'ai_generated'
$$;

do $r15_parity_check$
begin
  if public.novelight_discovery_zone('human', 'sensitive_15') <> 'general'
     or public.novelight_discovery_zone('ai_generated', 'sensitive_15') <> 'ai'
     or public.novelight_discovery_zone('human', 'adult_18_nonsexual') <> 'r18'
     or not public.novelight_is_light_seed_eligible('human', 'general')
     or not public.novelight_is_light_seed_eligible('human', 'sensitive_15')
     or not public.novelight_is_light_seed_eligible('ai_assisted', 'sensitive_15')
     or public.novelight_is_light_seed_eligible('ai_generated', 'sensitive_15')
     or public.novelight_is_light_seed_eligible('ai_generated', 'general')
     or public.novelight_is_light_seed_eligible('human', 'adult_18_nonsexual')
     or strpos(pg_get_functiondef('public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure), 'rating_ranked as materialized') <> 0 then
    raise exception 'R15 recommendation and LIGHT SEED parity invariants failed';
  end if;
end
$r15_parity_check$;

commit;
