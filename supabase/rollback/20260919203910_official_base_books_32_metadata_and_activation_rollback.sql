-- Roll back only the schema/RPC addition before official pack data exists.
-- Once the 32-book pack has been staged or activated, rollback must be handled
-- by an explicit forward recovery plan rather than deleting canonical metadata.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919203910:official-base-books-32:rollback'));

do $$
begin
  if exists (
    select 1
      from public.novel_thumbnail_assets
     where source_pack_key = 'NOVELIGHT_base_books_32_final'
  ) then
    raise exception using errcode = '55000',
      message = 'Refusing rollback: official base_book pack rows already exist';
  end if;
end;
$$;

drop function if exists public.novelight_admin_activate_official_base_book_pack(
  uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,uuid,text,text
);
drop function if exists public.novelight_admin_stage_official_base_book(
  uuid,text,text,text,text,text,integer,text,text,text
);

drop index if exists public.novel_thumbnail_assets_pack_layer_order_unique;
drop index if exists public.novel_thumbnail_assets_pack_file_unique;

alter table public.novel_thumbnail_assets
  drop constraint if exists novel_thumbnail_assets_source_sha256_check,
  drop constraint if exists novel_thumbnail_assets_source_file_name_check,
  drop constraint if exists novel_thumbnail_assets_source_pack_key_check,
  drop constraint if exists novel_thumbnail_assets_material_ja_check,
  drop constraint if exists novel_thumbnail_assets_display_name_ja_check,
  drop column if exists source_sha256,
  drop column if exists source_file_name,
  drop column if exists source_pack_key,
  drop column if exists material_ja,
  drop column if exists display_name_ja;

commit;
