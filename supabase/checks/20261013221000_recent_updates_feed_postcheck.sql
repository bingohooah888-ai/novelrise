-- Read-only postcheck: new-arrivals must follow visible episode publication.
do $postcheck$
declare
  v_signature regprocedure := to_regprocedure(
    'public.novelight_recent_updates_feed(integer,integer)'
  );
  v_expected text[];
  v_actual text[];
begin
  if v_signature is null then
    raise exception 'recent-updates feed was not installed';
  end if;

  if not has_function_privilege('anon', v_signature, 'EXECUTE')
     or not has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception 'public feed must be callable by anonymous and authenticated readers';
  end if;

  if exists (
    select 1
    from public.novelight_recent_updates_feed(100, 0) as f
    join public.novels n on n.id::text = f.novel_id
    where n.status <> 'published'
       or not public.novelight_is_general_discovery_eligible(
         n.ai_usage, n.content_rating
       )
  ) then
    raise exception 'feed returned unpublished or ineligible works';
  end if;

  with candidates as (
    select
      n.id::text as novel_id,
      n.created_at,
      coalesce(
        (
          select max(coalesce(e.first_published_at, e.created_at))
          from public.episodes e
          where e.novel_id = n.id
            and e.status = 'published'
            and (
              e.scheduled_publish_at is null
              or e.scheduled_publish_at <= now()
            )
        ),
        public.novelight_effective_publication_at(
          n.created_at, n.first_published_at
        )
      ) as last_published_at
    from public.novels n
    where n.status = 'published'
      and public.novelight_is_general_discovery_eligible(
        n.ai_usage, n.content_rating
      )
  ), expected as (
    select c.novel_id, row_number() over (
      order by c.last_published_at desc, c.created_at desc, c.novel_id asc
    ) as position
    from candidates c
  )
  select array_agg(e.novel_id order by e.position)
  into v_expected
  from expected e
  where e.position <= 24;

  select array_agg(f.novel_id order by f.position)
  into v_actual
  from public.novelight_recent_updates_feed(24, 0)
       with ordinality as f(novel_id, title, genre, description, created_at, pv, favorite_count, total_count, position);

  if coalesce(v_expected, '{}'::text[]) <> coalesce(v_actual, '{}'::text[]) then
    raise exception 'feed order differs from eligible publicly published episode recency';
  end if;
end
$postcheck$;
