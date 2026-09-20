begin;

do $$
declare
  v_rls_count integer;
begin
  if (select count(*) from public.official_tag_categories) <> 12 then
    raise exception 'official tag category count mismatch';
  end if;
  if (select count(*) from public.official_tags) <> 296 then
    raise exception 'official tag count mismatch';
  end if;
  if not exists (
    select 1 from public.official_tags where id='yuri_gl' and display_name='百合／GL' and is_active
  ) or not exists (
    select 1 from public.official_tags where id='bl' and display_name='BL' and is_active
  ) or not exists (
    select 1 from public.official_tags where id='ts_gender_swap' and display_name='TS／性別転換' and is_active
  ) then
    raise exception 'required cross-genre official tags are missing';
  end if;
  if not exists (
    select 1 from public.official_tag_aliases where tag_id='yuri_gl' and alias_normalized='ガールズラブ'
  ) or not exists (
    select 1 from public.official_tag_aliases where tag_id='bl' and alias_normalized='ボーイズラブ'
  ) or not exists (
    select 1 from public.official_tag_aliases where tag_id='ts_gender_swap' and alias_normalized='tsf'
  ) then
    raise exception 'required aliases are missing';
  end if;

  select count(*) into v_rls_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in (
      'official_tag_categories','official_tags','official_tag_aliases',
      'novel_official_tags','novel_custom_tags','novel_internal_search_attributes'
    )
    and c.relrowsecurity;
  if v_rls_count <> 6 then
    raise exception 'RLS is not enabled on all classification tables';
  end if;

  if has_table_privilege('anon','public.novel_official_tags','INSERT')
     or has_table_privilege('authenticated','public.novel_official_tags','INSERT')
     or has_table_privilege('anon','public.official_tags','UPDATE')
     or has_table_privilege('authenticated','public.official_tags','UPDATE') then
    raise exception 'client write privileges leaked to classification tables';
  end if;
  if has_table_privilege('anon','public.novel_internal_search_attributes','SELECT')
     or has_table_privilege('authenticated','public.novel_internal_search_attributes','SELECT') then
    raise exception 'future internal search attributes leaked to clients';
  end if;

  if to_regprocedure('public.novelight_official_tag_catalog()') is null
     or to_regprocedure('public.novelight_set_novel_tags(bigint,text[],text[])') is null
     or to_regprocedure('public.novelight_novel_tag_labels(bigint[])') is null
     or to_regprocedure('public.novelight_neutral_search_v2(text,text,text[],text,integer,integer)') is null then
    raise exception 'classification RPC contract is incomplete';
  end if;
end
$$;

rollback;
