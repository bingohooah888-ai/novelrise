\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.contact_inquiries') is not null
     and exists (select 1 from public.contact_inquiries limit 1) then
    raise exception 'Refusing rollback: contact inquiries exist. Export or resolve them before dropping the support channel.';
  end if;
end
$$;

drop function if exists public.submit_contact_inquiry(text, text, text, text, text);
drop table if exists public.contact_inquiries;
