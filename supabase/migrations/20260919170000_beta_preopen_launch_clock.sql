-- NOVELIGHT beta audit: make preopen works start launch-timed benefits at 2026-09-30 JST.
--
-- Raw creation/publication timestamps remain unchanged. Only launch-relative
-- mechanics (new-arrival ordering, initial exposure, Premium 48h boost and
-- receipt attribution) use the effective publication timestamp.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919170000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.beta_launch_clock_function_state (
  migration_id text not null,
  function_signature text not null,
  definition text not null,
  applied_at timestamptz not null default now(),
  primary key (migration_id, function_signature)
);

insert into novelrise_migration_backup.beta_launch_clock_function_state (
  migration_id,
  function_signature,
  definition
)
select '20260919170000', signature, pg_get_functiondef(signature::regprocedure)
from (
  values
    ('public.novelight_discovery_feed_v2(text,integer,text,text,text)'),
    ('public.novelight_neutral_search(text,text,text,integer,integer)'),
    ('public.record_novel_impressions_v2(text,text[],text)'),
    ('private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)')
) as required(signature)
on conflict (migration_id, function_signature) do nothing;

create or replace function public.novelight_effective_publication_at(
  p_created_at timestamptz,
  p_first_published_at timestamptz
)
returns timestamptz
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select greatest(
    coalesce(p_first_published_at, p_created_at),
    timestamptz '2026-09-30 00:00:00+09'
  )
$$;

revoke all on function public.novelight_effective_publication_at(
  timestamptz, timestamptz
) from public, anon, authenticated;

do $patch$
declare
  v_definition text;
begin
  -- Main discovery allocation: preserve real created_at for display/tie-breaks,
  -- while time-limited benefit checks use effective_publication_at.
  select pg_get_functiondef(
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'public.novelight_effective_publication_at(') = 0 then
    if pg_catalog.strpos(v_definition, 'n.created_at,') = 0
       or pg_catalog.strpos(v_definition, 'n.created_at >= now() - make_interval(hours => r.premium_new_work_hours)') = 0
       or pg_catalog.strpos(v_definition, 'm.created_at >= now() - make_interval(days => m.initial_exposure_window_days)') = 0 then
      raise exception 'Discovery feed no longer matches the audited launch-clock contract';
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      '      n.created_at,' || E'\n' || '      coalesce(n.pv, 0)::bigint as pv,',
      '      n.created_at,' || E'\n'
        || '      public.novelight_effective_publication_at(' || E'\n'
        || '        n.created_at, n.first_published_at' || E'\n'
        || '      ) as effective_publication_at,' || E'\n'
        || '      coalesce(n.pv, 0)::bigint as pv,'
    );
    v_definition := pg_catalog.replace(
      v_definition,
      'n.created_at >= now() - make_interval(hours => r.premium_new_work_hours)',
      'public.novelight_effective_publication_at(n.created_at, n.first_published_at) <= now()' || E'\n'        || '          and public.novelight_effective_publication_at(n.created_at, n.first_published_at) >= now() - make_interval(hours => r.premium_new_work_hours)'
    );
    v_definition := pg_catalog.replace(
      v_definition,
      'm.created_at >= now() - make_interval(days => m.initial_exposure_window_days)',
      'm.effective_publication_at <= now()' || E'\n'        || '        and m.effective_publication_at >= now() - make_interval(days => m.initial_exposure_window_days)'
    );

    v_definition := pg_catalog.replace(
      v_definition,
      '        where e.novel_id_snapshot = b.novel_id' || E'\n'
        || '      ) as novel_exposures_total,',
      '        where e.novel_id_snapshot = b.novel_id' || E'\n'
        || '          and e.exposed_at >= b.effective_publication_at' || E'\n'
        || '      ) as novel_exposures_total,'
    );

    if pg_catalog.strpos(v_definition, 'effective_publication_at') = 0
       or pg_catalog.strpos(v_definition, 'e.exposed_at >= b.effective_publication_at') = 0 then
      raise exception 'Discovery launch-clock patch failed';
    end if;
    execute v_definition;
  end if;

  -- Neutral "new" search: all preopen works share the launch-time primary key,
  -- then retain their real publication order as a deterministic tie-break.
  select pg_get_functiondef(
    'public.novelight_neutral_search(text,text,text,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'effective_publication_at') = 0 then
    if pg_catalog.strpos(v_definition, 'n.created_at,') = 0
       or pg_catalog.strpos(v_definition, 'case when p_sort = ''favorites'' then c.favorite_count end desc nulls last,') = 0 then
      raise exception 'Neutral search no longer matches the audited new-arrival contract';
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      '      n.created_at,' || E'\n' || '      coalesce(n.pv, 0)::bigint as pv,',
      '      n.created_at,' || E'\n'
        || '      public.novelight_effective_publication_at(' || E'\n'
        || '        n.created_at, n.first_published_at' || E'\n'
        || '      ) as effective_publication_at,' || E'\n'
        || '      coalesce(n.pv, 0)::bigint as pv,'
    );
    v_definition := pg_catalog.replace(
      v_definition,
      '    case when p_sort = ''favorites'' then c.favorite_count end desc nulls last,' || E'\n'
        || '    c.created_at desc,',
      '    case when p_sort = ''favorites'' then c.favorite_count end desc nulls last,' || E'\n'
        || '    case when p_sort = ''new'' then c.effective_publication_at end desc nulls last,' || E'\n'
        || '    c.created_at desc,'
    );

    if pg_catalog.strpos(v_definition, 'case when p_sort = ''new'' then c.effective_publication_at') = 0 then
      raise exception 'Neutral-search launch-clock patch failed';
    end if;
    execute v_definition;
  end if;

  -- Legacy impression writer still exists for compatibility; keep its
  -- initial-exposure attribution aligned even though trusted receipts are primary.
  select pg_get_functiondef(
    'public.record_novel_impressions_v2(text,text[],text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'public.novelight_effective_publication_at(') = 0 then
    if pg_catalog.strpos(
         v_definition,
         'n.created_at >= now() - make_interval(days => r.initial_exposure_window_days)'
       ) = 0 then
      raise exception 'Legacy impression writer no longer matches launch-clock contract';
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      'n.created_at >= now() - make_interval(days => r.initial_exposure_window_days)',
      'public.novelight_effective_publication_at(n.created_at, n.first_published_at) <= now()' || E'\n'        || '       and public.novelight_effective_publication_at(n.created_at, n.first_published_at) >= now() - make_interval(days => r.initial_exposure_window_days)'
    );
    execute v_definition;
  end if;

  -- Trusted receipt attribution must agree with the discovery allocator.
  select pg_get_functiondef(
    'private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'public.novelight_effective_publication_at(') = 0 then
    if pg_catalog.strpos(
         v_definition,
         'a.created_at >= now() - make_interval(days => r.initial_exposure_window_days)'
       ) = 0 then
      raise exception 'Trusted discovery receipt issuer no longer matches launch-clock contract';
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      'a.created_at >= now() - make_interval(days => r.initial_exposure_window_days)',
      'public.novelight_effective_publication_at(' || E'\n'
        || '          a.created_at,' || E'\n'
        || '          (select n.first_published_at from public.novels n where n.id::text = a.novel_id)' || E'\n'
        || '        ) <= now()' || E'\n'
        || '        and public.novelight_effective_publication_at(' || E'\n'
        || '          a.created_at,' || E'\n'
        || '          (select n.first_published_at from public.novels n where n.id::text = a.novel_id)' || E'\n'
        || '        ) >= now() - make_interval(days => r.initial_exposure_window_days)'
    );
    v_definition := pg_catalog.replace(
      v_definition,
      '            where e.novel_id_snapshot = a.novel_id' || E'\n'
        || '          ) < r.initial_exposure_target',
      '            where e.novel_id_snapshot = a.novel_id' || E'\n'
        || '              and e.exposed_at >= public.novelight_effective_publication_at(' || E'\n'
        || '                a.created_at,' || E'\n'
        || '                (select n.first_published_at from public.novels n where n.id::text = a.novel_id)' || E'\n'
        || '              )' || E'\n'
        || '          ) < r.initial_exposure_target'
    );

    if pg_catalog.strpos(v_definition, 'e.exposed_at >= public.novelight_effective_publication_at(') = 0 then
      raise exception 'Trusted discovery launch-clock consumption boundary is missing';
    end if;
    execute v_definition;
  end if;
end
$patch$;

commit;
