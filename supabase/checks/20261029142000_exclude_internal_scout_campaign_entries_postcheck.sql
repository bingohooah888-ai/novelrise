-- Post-apply read-only attestation; print only schema fingerprints.
do $postcheck$
declare
  v_triggers integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028084410') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261029142000') <> 1 then
    raise exception 'Staging migration ledger does not contain exactly both versions';
  end if;
  if md5(pg_catalog.pg_get_functiondef(
      'public.novelight_capture_scout_campaign_entry()'::regprocedure
    )) <> '4d52acf3a1d5f52db73456357a39d5fc' then
    raise exception 'Staging campaign function post-apply fingerprint invalid';
  end if;
  select count(*) into v_triggers
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
    and not t.tgisinternal;
  if v_triggers <> 6 then
    raise exception 'Staging Auth trigger coverage changed';
  end if;
  if exists (
    select 1 from public.scout_reward_campaign_entries
    where user_id = '00000000-0000-4000-8000-000000000943'::uuid
  ) then
    raise exception 'Synthetic campaign record residue remains';
  end if;
end
$postcheck$;
select 'STAGING_AUTH_USERS_TRIGGER_MD5=' ||
  md5(string_agg(
    t.tgname || ':' || pg_catalog.pg_get_triggerdef(t.oid) ||
      chr(10) || pg_catalog.pg_get_functiondef(t.tgfoid),
    chr(10) order by t.tgname
  ))
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users'
  and not t.tgisinternal;
