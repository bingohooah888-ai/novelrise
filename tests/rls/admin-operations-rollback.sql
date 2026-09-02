\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.announcements') is not null then
    raise exception 'Rollback verification failed: announcements still exists';
  end if;

  if to_regclass('public.admin_operation_audit') is not null then
    raise exception 'Rollback verification failed: admin_operation_audit still exists';
  end if;

  if to_regprocedure('public.novelight_admin_create_announcement(uuid,text,text,text,text)') is not null
     or to_regprocedure('public.novelight_admin_update_announcement(uuid,bigint,text,text,text,text)') is not null
     or to_regprocedure('public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)') is not null then
    raise exception 'Rollback verification failed: ADMIN operations RPC still exists';
  end if;

  if to_regclass('public.contact_inquiries') is null then
    raise exception 'Rollback verification failed: existing contact inquiry channel was removed';
  end if;

  if to_regprocedure('public.submit_contact_inquiry(text,text,text,text,text)') is null then
    raise exception 'Rollback verification failed: existing contact inquiry RPC was removed';
  end if;
end
$$;
