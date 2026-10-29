-- Staging-read-only candidate-plus-campaign precheck; no user rows exposed.
-- Run only after the destination Supabase project ref is separately authenticated.
do $precheck$
declare
  v_triggers integer;
  v_hash text;
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028084410') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261029142000') <> 0 then
    raise exception 'Staging candidate or pending migration version mismatch';
  end if;
  if (select count(*) from public.novelight_ai_review_candidates) <> 0
     or not exists (
       select 1 from public.novelight_ai_runtime_settings
       where singleton = 1 and enabled = false
         and user_day_cap_micros = 0 and user_month_cap_micros = 0
         and global_day_cap_micros = 0 and global_month_cap_micros = 0
     ) then
    raise exception 'AI review staging state unsafe';
  end if;
  if md5(pg_catalog.pg_get_functiondef(
      'public.novelight_capture_scout_campaign_entry()'::regprocedure
    )) <> 'fcf216ef3062983bea13ff4143b92f53' then
    raise exception 'Unreviewed baseline SCOUT campaign function';
  end if;
  select count(*), md5(string_agg(
    t.tgname || ':' || pg_catalog.pg_get_triggerdef(t.oid) ||
      chr(10) || pg_catalog.pg_get_functiondef(t.tgfoid),
    chr(10) order by t.tgname))
  into v_triggers, v_hash
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
    and not t.tgisinternal;
  if v_triggers <> 6 or v_hash <> '1a534e511428bd56bd1518ff8daad95a' then
    raise exception 'Staging Auth trigger baseline fingerprint differs';
  end if;
  if exists (
    select 1 from public.scout_reward_campaign_entries
    where user_id = '00000000-0000-4000-8000-000000000943'::uuid
  ) then
    raise exception 'Synthetic campaign row already exists';
  end if;
end
$precheck$;
