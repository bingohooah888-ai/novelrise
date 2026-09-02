\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.contact_inquiries') is null then
    raise exception 'Precheck failed: public.contact_inquiries is missing';
  end if;

  if to_regprocedure('public.submit_contact_inquiry(text,text,text,text,text)') is null then
    raise exception 'Precheck failed: submit_contact_inquiry is missing';
  end if;

  if to_regclass('public.announcements') is not null then
    raise exception 'Precheck failed: public.announcements already exists';
  end if;

  if to_regclass('public.admin_operation_audit') is not null then
    raise exception 'Precheck failed: public.admin_operation_audit already exists';
  end if;

  if to_regprocedure('public.novelight_admin_create_announcement(uuid,text,text,text,text)') is not null
     or to_regprocedure('public.novelight_admin_update_announcement(uuid,bigint,text,text,text,text)') is not null
     or to_regprocedure('public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)') is not null then
    raise exception 'Precheck failed: ADMIN operations RPC already exists';
  end if;
end
$$;
