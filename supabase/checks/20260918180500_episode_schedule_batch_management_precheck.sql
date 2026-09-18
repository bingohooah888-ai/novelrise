\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'PRECHECK FAIL: B #13 requires novels and episodes';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception 'PRECHECK FAIL: scheduled publication foundation is missing';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is null then
    raise exception 'PRECHECK FAIL: scheduled publication RPC foundation is incomplete';
  end if;

  if to_regprocedure('public.novelight_batch_manage_episode_schedules(bigint,jsonb)') is not null then
    raise exception 'PRECHECK FAIL: B #13 batch schedule RPC already exists';
  end if;
end
$$;

select 'PRECHECK PASS: B #13 batch schedule prerequisites are ready' as result;
