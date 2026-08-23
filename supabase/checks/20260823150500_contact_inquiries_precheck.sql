\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.contact_inquiries') is not null then
    raise exception 'Precheck failed: public.contact_inquiries already exists';
  end if;

  if to_regprocedure('public.submit_contact_inquiry(text,text,text,text,text)') is not null then
    raise exception 'Precheck failed: submit_contact_inquiry already exists';
  end if;
end
$$;
