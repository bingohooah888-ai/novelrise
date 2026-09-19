-- NOVELIGHT restored-database structural and integrity validation.
-- Read-only: safe for a restored/disposable target. Do not use this as a substitute
-- for provider backup/PITR or for a real restore rehearsal.
\set ON_ERROR_STOP on

do $$
declare
  v_name text;
  v_missing text[] := '{}'::text[];
  v_required_tables text[] := array[
    'profiles','novels','episodes','favorites',
    'light_seeds','novel_exposure_rules','novel_exposure_events',
    'novel_exposure_conversions','content_reports','reader_journey_events',
    'beta_activity_days','user_lifecycle','subscription_event_log',
    'valid_read_events','valid_read_sessions','valid_read_rules',
    'novel_rank_state','novel_rank_events','episode_revisions',
    'reader_reading_progress','reader_bookshelf_entries','user_blocks','user_mutes',
    'novel_series','novel_series_items','novel_chapters',
    'novel_characters','novel_character_episode_states',
    'author_notes','novel_polls','novel_poll_options','novel_poll_votes',
    'reader_curation_lists','reader_curation_list_items',
    'novel_collaborators','novel_collaboration_invites','novel_collaboration_events',
    'novel_private_story_notes'
  ];
begin
  foreach v_name in array v_required_tables loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Restore validation missing required tables: %', array_to_string(v_missing, ', ');
  end if;
end
$$;

do $$
declare
  v_name text;
  v_unprotected text[] := '{}'::text[];
  v_private_tables text[] := array[
    'content_reports','reader_journey_events',
    'valid_read_events','valid_read_sessions','episode_revisions',
    'reader_reading_progress','reader_bookshelf_entries','user_blocks','user_mutes',
    'novel_collaborators','novel_collaboration_invites','novel_collaboration_events',
    'novel_private_story_notes'
  ];
begin
  foreach v_name in array v_private_tables loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and c.relkind in ('r','p')
        and c.relrowsecurity
    ) then
      v_unprotected := array_append(v_unprotected, v_name);
    end if;
  end loop;

  if cardinality(v_unprotected) > 0 then
    raise exception 'Restore validation found required private tables without RLS: %',
      array_to_string(v_unprotected, ', ');
  end if;
end
$$;

do $$
declare
  v_name text;
  v_exposed text[] := '{}'::text[];
  v_revoke_tables text[] := array[
    'novel_exposure_events',
    'novel_exposure_conversions'
  ];
begin
  foreach v_name in array v_revoke_tables loop
    if has_table_privilege('anon', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE') then
      v_exposed := array_append(v_exposed, v_name);
    end if;
  end loop;

  if cardinality(v_exposed) > 0 then
    raise exception 'Restore validation found exposure ledgers with direct client privileges: %',
      array_to_string(v_exposed, ', ');
  end if;
end
$$;

do $$
declare
  v_name text;
  v_missing text[] := '{}'::text[];
  v_functions text[] := array[
    'record_valid_read_progress',
    'novelight_discovery_feed_v2',
    'novelight_ranking_feed_v2',
    'novelight_neutral_search',
    'novelight_can_favorite_novel',
    'novelight_favorite_count',
    'light_seed_status_v2',
    'plant_light_seed_v2'
  ];
begin
  foreach v_name in array v_functions loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Restore validation missing required functions: %',
      array_to_string(v_missing, ', ');
  end if;
end
$$;
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  where u.id is null;
  if v_count <> 0 then
    raise exception 'Restore validation found % orphan profiles', v_count;
  end if;

  select count(*) into v_count
  from public.episodes e
  left join public.novels n on n.id = e.novel_id
  where n.id is null;
  if v_count <> 0 then
    raise exception 'Restore validation found % orphan episodes', v_count;
  end if;

  select count(*) into v_count
  from (
    select user_id, novel_id
    from public.favorites
    group by user_id, novel_id
    having count(*) > 1
  ) d;
  if v_count <> 0 then
    raise exception 'Restore validation found % duplicate favorite pairs', v_count;
  end if;
  if not exists (select 1 from public.novel_exposure_rules where id = 1) then
    raise exception 'Restore validation missing active novel_exposure_rules row id=1';
  end if;

  if not exists (select 1 from public.valid_read_rules where id = 1) then
    raise exception 'Restore validation missing active valid_read_rules row id=1';
  end if;
end
$$;

select
  'NOVELIGHT restore validation PASS' as result,
  current_database() as database_name,
  now() as checked_at;
