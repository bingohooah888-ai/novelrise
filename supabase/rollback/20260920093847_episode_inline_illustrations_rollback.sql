begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920093847:rollback'));

do $$
begin
  if to_regclass('public.episode_illustrations') is not null
     and exists (select 1 from public.episode_illustrations limit 1) then
    raise exception 'Rollback blocked: episode illustration asset registry contains user data';
  end if;

  if exists (
    select 1 from public.novels n
     where n.illustration_ai_usage is not null
  ) then
    raise exception 'Rollback blocked: illustration AI declarations contain user data';
  end if;

  if exists (
    select 1 from public.author_work_export_audit a
     where a.format='zip'
  ) then
    raise exception 'Rollback blocked: ZIP backup audit records depend on illustration export support';
  end if;

  if to_regclass('public.episode_illustration_upload_audit') is not null
     and exists (select 1 from public.episode_illustration_upload_audit limit 1) then
    raise exception 'Rollback blocked: illustration upload audit contains abuse-control evidence';
  end if;
end
$$;

drop function if exists public.novelight_owner_illustration_export_bundle(bigint,uuid);
drop function if exists public.novelight_authorize_episode_illustration_upload(bigint,uuid);
drop function if exists public.novelight_public_episode_illustration_bundle(bigint);
drop function if exists public.novelight_update_episode_illustration_alt(uuid,uuid,text);
drop function if exists public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text);
drop function if exists public.novelight_set_illustration_ai_usage(bigint,uuid,boolean);
drop function if exists public.novelight_episode_illustration_editor_bundle(bigint,uuid);
drop table if exists public.episode_illustration_upload_audit;
drop table if exists public.episode_illustrations;
alter table public.novels drop column if exists illustration_ai_usage;


alter table public.author_work_export_audit
  drop constraint if exists author_work_export_audit_format_check;

alter table public.author_work_export_audit
  add constraint author_work_export_audit_format_check
  check (format = 'txt');

create or replace function public.novelight_authorize_work_export(
  p_novel_id bigint,
  p_format text default 'txt'
)
returns table (
  audit_id uuid,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_format text := lower(trim(coalesce(p_format, '')));
  v_now timestamptz := clock_timestamp();
  v_audit_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_novel_id is null or p_novel_id <= 0 then
    raise exception 'invalid_export_request' using errcode = '22023';
  end if;

  if v_format <> 'txt' then
    raise exception 'unsupported_export_format' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('novelight:author-work-export:' || v_uid::text)
  );

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception 'export_not_found' using errcode = 'P0002';
  end if;

  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '10 minutes'
  ) >= 10 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '24 hours'
  ) >= 50 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.author_work_export_audit (
    user_id, novel_id, format, requested_at
  ) values (
    v_uid, p_novel_id, v_format, v_now
  )
  returning id into v_audit_id;

  return query select v_audit_id, v_now;
end
$$;

revoke all on function public.novelight_authorize_work_export(bigint,text)
  from public, anon, authenticated;
grant execute on function public.novelight_authorize_work_export(bigint,text)
  to authenticated;

-- The private Storage bucket is intentionally preserved. A separate orphan-cleanup
-- operation may remove an empty bucket only after current Storage state is verified.
commit;
