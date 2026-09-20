begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920221000:rollback'));

do $$
begin
  if to_regclass('public.novel_official_tags') is not null
     and exists(select 1 from public.novel_official_tags limit 1) then
    raise exception 'Rollback blocked: official tags are already attached to works';
  end if;
  if to_regclass('public.novel_custom_tags') is not null
     and exists(select 1 from public.novel_custom_tags limit 1) then
    raise exception 'Rollback blocked: custom tags contain author data';
  end if;
  if to_regclass('public.novel_internal_search_attributes') is not null
     and exists(select 1 from public.novel_internal_search_attributes limit 1) then
    raise exception 'Rollback blocked: internal search attributes contain data';
  end if;
end
$$;

drop function if exists public.novelight_neutral_search_v2(text, text, text[], text, integer, integer);
drop function if exists public.novelight_novel_tag_labels(bigint[]);
drop function if exists public.novelight_set_novel_tags(bigint, text[], text[]);
drop function if exists public.novelight_official_tag_catalog();
drop function if exists public.novelight_normalize_custom_tag(text);

drop table if exists public.novel_internal_search_attributes;
drop table if exists public.novel_custom_tags;
drop table if exists public.novel_official_tags;
drop table if exists public.official_tag_aliases;
drop table if exists public.official_tags;
drop table if exists public.official_tag_categories;

commit;
