\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.contact_inquiries') is null,
  'contact_inquiries table must be removed after rollback'
);
select public.test_assert(
  to_regprocedure('public.submit_contact_inquiry(text,text,text,text,text)') is null,
  'submit_contact_inquiry must be removed after rollback'
);
