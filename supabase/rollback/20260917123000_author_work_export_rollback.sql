begin;

drop function if exists public.novelight_authorize_work_export(bigint, text);
drop table if exists public.author_work_export_audit;

commit;
