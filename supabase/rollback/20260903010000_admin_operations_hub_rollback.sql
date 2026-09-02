\set ON_ERROR_STOP on

begin;

drop function if exists public.novelight_admin_update_contact_inquiry_status(uuid, bigint, text);
drop function if exists public.novelight_admin_update_announcement(uuid, bigint, text, text, text, text);
drop function if exists public.novelight_admin_create_announcement(uuid, text, text, text, text);
drop table if exists public.admin_operation_audit;
drop table if exists public.announcements;

commit;
