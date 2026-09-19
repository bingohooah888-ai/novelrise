\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919102000'));

do $$
begin
  if to_regclass('public.reader_curation_list_items') is not null
     and exists (select 1 from public.reader_curation_list_items limit 1) then
    raise exception 'ROLLBACK REFUSED: B #21 curation items exist';
  end if;
  if to_regclass('public.reader_curation_lists') is not null
     and exists (select 1 from public.reader_curation_lists limit 1) then
    raise exception 'ROLLBACK REFUSED: B #21 curation lists exist';
  end if;
end
$$;

drop function if exists public.novelight_public_reader_curation(uuid);
drop function if exists public.novelight_delete_my_curation_list(bigint);
drop function if exists public.novelight_rotate_my_curation_share_token(bigint);
drop function if exists public.novelight_remove_my_curation_item(bigint,bigint);
drop function if exists public.novelight_add_my_curation_item(bigint,bigint);drop function if exists public.novelight_update_my_curation_list(bigint,text,text,text);
drop function if exists public.novelight_create_my_curation_list(text,text);
drop function if exists public.novelight_manage_my_curation_lists();
drop table if exists public.reader_curation_list_items;
drop table if exists public.reader_curation_lists;

commit;
