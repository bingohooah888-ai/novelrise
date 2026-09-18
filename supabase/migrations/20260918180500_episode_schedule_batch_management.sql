-- NOVELIGHT competitor audit B #13: multi-episode schedule management.
--
-- Extends the existing single-episode scheduler without adding another schedule
-- table or cron job. Authors can atomically set, move, or cancel up to 50 draft
-- episode schedules in one RPC. The existing due-publication worker remains the
-- only publication executor.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918180500'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'B #13 requires novels and episodes';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception 'B #13 requires the existing scheduled publication column';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is null then
    raise exception 'B #13 requires the existing scheduled publication RPCs';
  end if;

  if to_regprocedure('public.novelight_batch_manage_episode_schedules(bigint,jsonb)') is not null then
    raise exception 'B #13 batch schedule RPC already exists';
  end if;
end
$$;

create function public.novelight_batch_manage_episode_schedules(
  p_novel_id bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_novel_status text;
  v_item jsonb;
  v_episode_id bigint;
  v_publish_at timestamptz;
  v_publish_text text;
  v_episode_status text;
  v_episode_number bigint;
  v_title text;
  v_content text;
  v_episode_ids bigint[] := array[]::bigint[];
  v_change_count integer;
  v_key_count integer;
  v_first_schedule timestamptz;
  v_earliest_schedule timestamptz;
  v_schedule_rows jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_novel_id is null or p_novel_id < 1 then
    raise exception using errcode = '22023', message = 'A valid novel ID is required';
  end if;

  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    raise exception using errcode = '22023', message = 'Schedule changes must be a JSON array';
  end if;

  v_change_count := pg_catalog.jsonb_array_length(p_changes);
  if v_change_count < 1 or v_change_count > 50 then
    raise exception using errcode = '22023', message = 'Schedule changes must contain 1 to 50 episodes';
  end if;

  select n.status
    into v_novel_status
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  -- Validate the payload shape before locking or mutating episode rows.
  for v_item in
    select value
      from pg_catalog.jsonb_array_elements(p_changes)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'episode_id')
       or not (v_item ? 'publish_at') then
      raise exception using errcode = '22023', message = 'Each schedule change must contain episode_id and publish_at';
    end if;

    select count(*)::integer
      into v_key_count
      from pg_catalog.jsonb_object_keys(v_item);

    if v_key_count <> 2 then
      raise exception using errcode = '22023', message = 'Schedule change contains unsupported fields';
    end if;

    begin
      v_episode_id := (v_item ->> 'episode_id')::bigint;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Schedule episode_id must be a positive integer';
    end;

    if v_episode_id is null or v_episode_id < 1 then
      raise exception using errcode = '22023', message = 'Schedule episode_id must be a positive integer';
    end if;

    if v_episode_id = any(v_episode_ids) then
      raise exception using errcode = '22023', message = 'Schedule changes contain a duplicate episode';
    end if;
    v_episode_ids := pg_catalog.array_append(v_episode_ids, v_episode_id);

    if v_item -> 'publish_at' is not null
       and v_item -> 'publish_at' <> 'null'::jsonb then
      v_publish_text := v_item ->> 'publish_at';
      if v_publish_text is null or pg_catalog.btrim(v_publish_text) = '' then
        raise exception using errcode = '22023', message = 'publish_at must be an ISO timestamp or null';
      end if;
      begin
        v_publish_at := v_publish_text::timestamptz;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          raise exception using errcode = '22023', message = 'publish_at must be a valid timestamp';
      end;

      if v_publish_at < pg_catalog.now() + interval '2 minutes' then
        raise exception using errcode = '22023', message = 'Scheduled publication must be at least 2 minutes in the future';
      end if;
      if v_publish_at > pg_catalog.now() + interval '1 year' then
        raise exception using errcode = '22023', message = 'Scheduled publication cannot be more than 1 year in the future';
      end if;
    end if;
  end loop;

  -- Lock both the changed drafts and existing schedules for the work so that
  -- initial-publication ordering cannot race another schedule edit.
  perform 1
    from public.episodes e
   where e.novel_id = p_novel_id
     and e.user_id = v_uid
     and (
       e.scheduled_publish_at is not null
       or e.id = any(v_episode_ids)
     )
   order by e.id
   for update;

  -- Every target must still be an owned draft, and every newly scheduled row
  -- must be publication-ready at the moment the batch is committed.
  for v_item in
    select value
      from pg_catalog.jsonb_array_elements(p_changes)
  loop
    v_episode_id := (v_item ->> 'episode_id')::bigint;
    if v_item -> 'publish_at' is null
       or v_item -> 'publish_at' = 'null'::jsonb then
      v_publish_at := null;
    else
      v_publish_at := (v_item ->> 'publish_at')::timestamptz;
    end if;

    select e.status, e.episode_number, e.title, e.content
      into v_episode_status, v_episode_number, v_title, v_content
      from public.episodes e
     where e.id = v_episode_id
       and e.novel_id = p_novel_id
       and e.user_id = v_uid;

    if not found then
      raise exception using errcode = '42501', message = 'Scheduled draft not found or not owned by current user';
    end if;

    if v_episode_status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only draft episodes can be managed by the schedule batch';
    end if;

    if v_publish_at is not null then
      if v_episode_number is null or v_episode_number < 1 then
        raise exception using errcode = '22023', message = 'A valid episode number is required before scheduling';
      end if;
      if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_title, ''))) < 1
         or pg_catalog.char_length(v_title) > 150 then
        raise exception using errcode = '22023', message = 'Episode title must contain 1 to 150 characters before scheduling';
      end if;
      if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_content, ''))) < 1
         or pg_catalog.char_length(v_content) > 100000 then
        raise exception using errcode = '22023', message = 'Episode content must contain 1 to 100000 characters before scheduling';
      end if;
    end if;
  end loop;

  -- One RPC call is one transaction: either all requested schedule changes are
  -- accepted, or every change is rolled back together.
  for v_item in
    select value
      from pg_catalog.jsonb_array_elements(p_changes)
  loop
    v_episode_id := (v_item ->> 'episode_id')::bigint;
    if v_item -> 'publish_at' is null
       or v_item -> 'publish_at' = 'null'::jsonb then
      v_publish_at := null;
    else
      v_publish_at := (v_item ->> 'publish_at')::timestamptz;
    end if;

    update public.episodes
       set scheduled_publish_at = v_publish_at
     where id = v_episode_id
       and novel_id = p_novel_id
       and user_id = v_uid
       and status = 'draft';

    if not found then
      raise exception using errcode = '40001', message = 'Schedule batch raced with another episode update';
    end if;
  end loop;

  -- Before a work has ever been published, episode 1 must be the first
  -- scheduled release. Other episodes must be strictly later, preventing the
  -- minute-based worker from processing episode 2 before episode 1.
  if v_novel_status <> 'published' then
    select min(e.scheduled_publish_at)
      into v_earliest_schedule
      from public.episodes e
     where e.novel_id = p_novel_id
       and e.user_id = v_uid
       and e.status = 'draft'
       and e.scheduled_publish_at is not null;

    if v_earliest_schedule is not null then
      select e.scheduled_publish_at
        into v_first_schedule
        from public.episodes e
       where e.novel_id = p_novel_id
         and e.user_id = v_uid
         and e.status = 'draft'
         and e.episode_number = 1;

      if v_first_schedule is null or v_first_schedule <> v_earliest_schedule then
        raise exception using errcode = '22023', message = 'Episode 1 must be the first scheduled publication for an unpublished work';
      end if;

      if exists (
        select 1
          from public.episodes e
         where e.novel_id = p_novel_id
           and e.user_id = v_uid
           and e.status = 'draft'
           and e.episode_number <> 1
           and e.scheduled_publish_at is not null
           and e.scheduled_publish_at <= v_first_schedule
      ) then
        raise exception using errcode = '22023', message = 'Later episodes must be scheduled after episode 1 for an unpublished work';
      end if;
    end if;
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'episode_id', e.id,
               'episode_number', e.episode_number,
               'title', e.title,
               'scheduled_publish_at', e.scheduled_publish_at
             )
             order by e.episode_number, e.id
           ),
           '[]'::jsonb
         )
    into v_schedule_rows
    from public.episodes e
   where e.novel_id = p_novel_id
     and e.user_id = v_uid
     and e.status = 'draft'
     and e.scheduled_publish_at is not null;

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'scheduled', v_schedule_rows
  );
end
$$;

revoke all on function public.novelight_batch_manage_episode_schedules(bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_batch_manage_episode_schedules(bigint, jsonb)
  to authenticated;

comment on function public.novelight_batch_manage_episode_schedules(bigint, jsonb) is
  'B #13 owner-only atomic batch schedule management. Convenience only; does not alter Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, or exposure.';

commit;
