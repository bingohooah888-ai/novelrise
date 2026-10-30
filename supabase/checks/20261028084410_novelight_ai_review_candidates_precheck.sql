-- Read-only prerequisites. Runs before candidate migration, in same transaction.
-- No real user content or AI provider is accessed.
do $ai_review_precheck$
begin
  if pg_catalog.to_regclass('public.novels') is null
    or pg_catalog.to_regclass('public.episodes') is null
    or pg_catalog.to_regclass('public.novelight_ai_runtime_settings') is null
    or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'AI review precheck failed: base schema or digest missing';
  end if;
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text)') is not null then
    raise exception 'AI review precheck failed: candidate objects already exist';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    raise exception 'AI review precheck failed: Supabase roles missing';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (
      select 1 from public.novelight_ai_runtime_settings where singleton = 1
        and enabled = false and user_day_cap_micros = 0
        and user_month_cap_micros = 0 and global_day_cap_micros = 0
        and global_month_cap_micros = 0
    ) then
    raise exception 'AI review precheck failed: AI budget not strictly disabled';
  end if;
end;
$ai_review_precheck$;
