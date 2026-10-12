-- Undo the R15 recommendation interleave, preserving the 2026-10-12 zone merge.
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
commit;
