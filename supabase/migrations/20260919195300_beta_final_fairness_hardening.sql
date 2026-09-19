-- NOVELIGHT final beta fairness hardening.
-- Closes the remaining launch blockers found by the fresh 2026-09-19 audit:
-- 1) client-only progress + interaction can no longer qualify a valid read;
-- 2) authors cannot favorite their own work, and self-favorites are excluded defensively;
-- 3) public ranking counts qualified readers per work, not per-episode events;
-- 4) neutral-search "pv" compatibility no longer orders by spoofable raw PV;
-- 5) preopen exposure is excluded from the post-launch seven-day balance.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919195300'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.beta_final_fairness_function_state (
  migration_id text not null,
  function_signature text not null,
  definition text not null,
  applied_at timestamptz not null default now(),
  primary key (migration_id, function_signature)
);
insert into novelrise_migration_backup.beta_final_fairness_function_state (
  migration_id,
  function_signature,
  definition
)
select '20260919195300', signature, pg_get_functiondef(signature::regprocedure)
from (
  values
    ('public.record_valid_read_progress(text,uuid,double precision,integer,integer)'),
    ('public.novelight_recalculate_work_ranks(timestamp with time zone)'),
    ('public.novelight_ranking_feed_v2(text,integer)'),
    ('public.novelight_favorite_count(text)'),
    ('public.novelight_neutral_search(text,text,text,integer,integer)'),
    ('public.novelight_discovery_feed_v2(text,integer,text,text,text)'),
    ('public.light_seed_status_v2(text)'),
    ('public.plant_light_seed_v2(text,text)')
) as required(signature)
on conflict (migration_id, function_signature) do nothing;

create or replace function public.novelight_exposure_balance_start(
  p_now timestamptz
)
returns timestamptz
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select greatest(
    p_now - interval '7 days',
    timestamptz '2026-09-30 00:00:00+09'
  )
$$;

revoke all on function public.novelight_exposure_balance_start(timestamptz)
  from public, anon, authenticated;

create or replace function public.novelight_can_favorite_novel(p_novel_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.novels n
      where n.id = p_novel_id
        and n.status = 'published'
        and n.user_id <> (select auth.uid())
    )
$$;

revoke all on function public.novelight_can_favorite_novel(bigint)
  from public, anon, authenticated;
grant execute on function public.novelight_can_favorite_novel(bigint)
  to authenticated;

drop policy if exists "Users can add own favorites" on public.favorites;
create policy "Users can add own favorites"
on public.favorites
for insert
to public
with check (
  (select auth.uid()) = user_id
  and public.novelight_can_favorite_novel(novel_id)
);

create index if not exists favorites_novel_id_user_id_idx
  on public.favorites (novel_id, user_id);
do $patch$
declare
  v_definition text;
  v_original text;
begin
  -- A valid read must include server-clock foreground time. Client-controlled
  -- progress + interaction alone can never create a qualification.
  select pg_get_functiondef(
    'public.record_valid_read_progress(text,uuid,double precision,integer,integer)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  if pg_catalog.strpos(v_definition, 'if v_signal_count >= 2 then') = 0
     or pg_catalog.strpos(
       v_definition,
       '''qualified'', v_signal_count >= 2 or v_existing'
     ) = 0 then
    raise exception 'Valid-read function no longer matches the audited contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'if v_signal_count >= 2 then',
    'if v_foreground_signal and (v_progress_signal or v_interaction_signal) then'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    '''qualified'', v_signal_count >= 2 or v_existing',
    '''qualified'', (v_foreground_signal and (v_progress_signal or v_interaction_signal)) or v_existing'
  );

  if v_definition = v_original
     or pg_catalog.strpos(
       v_definition,
       'if v_foreground_signal and (v_progress_signal or v_interaction_signal) then'
     ) = 0 then
    raise exception 'Valid-read foreground hardening failed';
  end if;
  execute v_definition;

  -- Work Rank uses unique qualified readers, not the number of episodes a
  -- single account qualified. Self-favorites are excluded defensively.
  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  if pg_catalog.strpos(
       v_definition,
       'count(distinct f.user_id)::bigint as favorite_count'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'select count(*)::bigint' || E'\n'
         || '                from public.valid_read_events vr'
     ) = 0 then
    raise exception 'Rank evaluator no longer matches the audited fairness contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '        from public.favorites f' || E'\n'
      || '       group by f.novel_id::text',
    '        from public.favorites f' || E'\n'
      || '        join public.novels fn on fn.id = f.novel_id' || E'\n'
      || '       where f.user_id <> fn.user_id' || E'\n'
      || '       group by f.novel_id::text'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    '             (select count(*)::bigint' || E'\n'
      || '                from public.valid_read_events vr' || E'\n'
      || '               where vr.novel_id_snapshot = n.id::text) as valid_read_count,',
    '             (select count(distinct vr.reader_id)::bigint' || E'\n'
      || '                from public.valid_read_events vr' || E'\n'
      || '               where vr.novel_id_snapshot = n.id::text' || E'\n'
      || '                 and vr.foreground_signal' || E'\n'
      || '                 and (vr.progress_signal or vr.interaction_signal)) as valid_read_count,'
  );

  if v_definition = v_original
     or pg_catalog.strpos(v_definition, 'count(distinct vr.reader_id)::bigint') = 0
     or pg_catalog.strpos(v_definition, 'where f.user_id <> fn.user_id') = 0 then
    raise exception 'Rank evaluator fairness hardening failed';
  end if;
  execute v_definition;

  -- Public ranking follows the same unique-qualified-reader and self-favorite
  -- contract so direct RPC consumers cannot bypass the authoritative metric.
  select pg_get_functiondef(
    'public.novelight_ranking_feed_v2(text,integer)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  v_definition := pg_catalog.replace(
    v_definition,
    'select count(*)::bigint' || E'\n'
      || '        from public.valid_read_events vr' || E'\n'
      || '        where vr.novel_id_snapshot = n.id::text',
    'select count(distinct vr.reader_id)::bigint' || E'\n'
      || '        from public.valid_read_events vr' || E'\n'
      || '        where vr.novel_id_snapshot = n.id::text' || E'\n'
      || '          and vr.foreground_signal' || E'\n'
      || '          and (vr.progress_signal or vr.interaction_signal)'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    '        where f.novel_id::text = n.id::text',
    '        where f.novel_id::text = n.id::text' || E'\n'
      || '          and f.user_id <> n.user_id'
  );

  if v_definition = v_original
     or pg_catalog.strpos(v_definition, 'count(distinct vr.reader_id)::bigint') = 0
     or pg_catalog.strpos(v_definition, 'and f.user_id <> n.user_id') = 0 then
    raise exception 'Public ranking fairness hardening failed';
  end if;
  execute v_definition;

  -- Public favorite totals also ignore any historical/self-service bypass rows.
  select pg_get_functiondef(
    'public.novelight_favorite_count(text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  if pg_catalog.strpos(
       v_definition,
       'where f.novel_id::text = p_novel_id'
     ) = 0 then
    raise exception 'Favorite-count function no longer matches audited contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '      where f.novel_id::text = p_novel_id',
    '      where f.novel_id::text = p_novel_id' || E'\n'
      || '        and f.user_id <> (' || E'\n'
      || '          select n.user_id from public.novels n' || E'\n'
      || '          where n.id::text = p_novel_id' || E'\n'
      || '        )'
  );
  if v_definition = v_original then
    raise exception 'Favorite-count self-exclusion failed';
  end if;
  execute v_definition;

  -- Neutral search keeps raw PV only as a displayed reference value. The old
  -- p_sort=PV compatibility path is remapped to launch-safe newness.
  select pg_get_functiondef(
    'public.novelight_neutral_search(text,text,text,integer,integer)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  if pg_catalog.strpos(
       v_definition,
       'case when p_sort = ''pv'' then c.pv end desc nulls last'
     ) = 0 then
    raise exception 'Neutral search no longer matches audited raw-PV sort contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '        where f.novel_id::text = n.id::text',
    '        where f.novel_id::text = n.id::text' || E'\n'
      || '          and f.user_id <> n.user_id'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'case when p_sort = ''pv'' then c.pv end desc nulls last',
    'case when p_sort = ''pv'' then c.effective_publication_at end desc nulls last'
  );

  if v_definition = v_original
     or pg_catalog.strpos(
       v_definition,
       'case when p_sort = ''pv'' then c.pv end'
     ) <> 0 then
    raise exception 'Neutral-search raw-PV ordering hardening failed';
  end if;
  execute v_definition;

  -- Discovery favorite counts ignore self-favorites and seven-day exposure
  -- balances start no earlier than the public beta launch.
  select pg_get_functiondef(
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  if pg_catalog.strpos(
       v_definition,
       'and e.exposed_at >= now() - interval ''7 days'''
     ) = 0 then
    raise exception 'Discovery feed no longer matches audited 7-day balance contract';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '        where f.novel_id::text = n.id::text',
    '        where f.novel_id::text = n.id::text' || E'\n'
      || '          and f.user_id <> n.user_id'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'and e.exposed_at >= now() - interval ''7 days''',
    'and e.exposed_at >= public.novelight_exposure_balance_start(now())'
  );
  if v_definition = v_original
     or pg_catalog.strpos(
       v_definition,
       'public.novelight_exposure_balance_start(now())'
     ) = 0 then
    raise exception 'Discovery preopen balance hardening failed';
  end if;
  execute v_definition;

  -- LIGHT SEED eligibility must consume only the newly hardened valid-read
  -- evidence, including when historical rows remain in the ledger.
  select pg_get_functiondef(
    'public.light_seed_status_v2(text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    '    where r.reader_id = v_uid' || E'\n'
      || '      and r.novel_id_snapshot = p_novel_id',
    '    where r.reader_id = v_uid' || E'\n'
      || '      and r.novel_id_snapshot = p_novel_id' || E'\n'
      || '      and r.foreground_signal' || E'\n'
      || '      and (r.progress_signal or r.interaction_signal)'
  );
  if v_definition = v_original then
    raise exception 'LIGHT SEED status valid-read hardening failed';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.plant_light_seed_v2(text,text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    '  where r.reader_id = v_uid' || E'\n'
      || '    and r.novel_id_snapshot = p_novel_id' || E'\n'
      || '  order by r.qualified_at asc, r.id asc',
    '  where r.reader_id = v_uid' || E'\n'
      || '    and r.novel_id_snapshot = p_novel_id' || E'\n'
      || '    and r.foreground_signal' || E'\n'
      || '    and (r.progress_signal or r.interaction_signal)' || E'\n'
      || '  order by r.qualified_at asc, r.id asc'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    '  where f.novel_id::text = p_novel_id;',
    '  where f.novel_id::text = p_novel_id' || E'\n'
      || '    and f.user_id <> v_author_id;'
  );
  if v_definition = v_original
     or pg_catalog.strpos(v_definition, 'and r.foreground_signal') = 0 then
    raise exception 'LIGHT SEED send-time fairness hardening failed';
  end if;
  execute v_definition;
end
$patch$;

commit;
