-- CI disposable replay PostgreSQL only. No hosted project access.
-- Only immutable schema fingerprints are printed; no user data or secrets.
select 'SCOUT_CAMPAIGN_FUNCTION_MD5=' ||
  md5(pg_catalog.pg_get_functiondef(
    'public.novelight_capture_scout_campaign_entry()'::regprocedure
  ));
select 'CI_AUTH_USERS_TRIGGER_MD5=' ||
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
begin;
insert into auth.users (id, email, created_at, raw_app_meta_data)
values
 ('00000000-0000-4000-8000-000000009961','ci-internal-campaign@example.invalid',
  '2026-10-29 12:00:00+09', '{"internal_e2e": true}'::jsonb),
 ('00000000-0000-4000-8000-000000009962','ci-normal-campaign@example.invalid',
  '2026-10-29 12:00:00+09', '{}'::jsonb);
do $assert$
begin
 if (select count(*) from public.scout_reward_campaign_entries
     where user_id='00000000-0000-4000-8000-000000009961'::uuid) <> 0 then
   raise exception 'Internal synthetic user wrongly enrolled';
 end if;
 if (select count(*) from public.scout_reward_campaign_entries
     where user_id='00000000-0000-4000-8000-000000009962'::uuid) <> 1 then
   raise exception 'Ordinary user campaign enrollment regressed';
 end if;
end
$assert$;
rollback;
