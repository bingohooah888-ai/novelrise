-- contact_inquiries.subject is the existing inquiry-type field.
-- Reuse it as the admin category so existing and future inquiries are filterable
-- without changing the public contact RPC contract.

update public.contact_inquiries
set category = left(trim(subject), 40)
where category = 'general'
  and nullif(trim(subject), '') is not null;

create or replace function public.novelight_sync_contact_inquiry_category()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.category is null
     or trim(new.category) = ''
     or new.category = 'general' then
    new.category := coalesce(left(nullif(trim(new.subject), ''), 40), 'general');
  end if;
  return new;
end;
$$;

drop trigger if exists contact_inquiries_sync_category on public.contact_inquiries;
create trigger contact_inquiries_sync_category
before insert or update of subject, category on public.contact_inquiries
for each row execute function public.novelight_sync_contact_inquiry_category();
