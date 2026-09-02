\set ON_ERROR_STOP on

do $$
declare
  v_has_announcements boolean := false;
  v_has_audit boolean := false;
begin
  if to_regclass('public.announcements') is not null then
    execute 'select exists (select 1 from public.announcements limit 1)'
      into v_has_announcements;
  end if;

  if to_regclass('public.admin_operation_audit') is not null then
    execute 'select exists (select 1 from public.admin_operation_audit limit 1)'
      into v_has_audit;
  end if;

  if v_has_announcements or v_has_audit then
    raise exception 'Refusing rollback: announcement or ADMIN audit data exists. Export and explicitly clear retained operator data before dropping the operations hub.';
  end if;
end
$$;

begin;

drop function if exists public.novelight_admin_update_contact_inquiry_status(uuid, bigint, text);
drop function if exists public.novelight_admin_update_announcement(uuid, bigint, text, text, text, text);
drop function if exists public.novelight_admin_create_announcement(uuid, text, text, text, text);
drop table if exists public.admin_operation_audit;
drop table if exists public.announcements;

commit;
