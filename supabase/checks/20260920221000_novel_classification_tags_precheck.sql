begin;

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'novels foundation is missing';
  end if;
  if to_regclass('public.official_tags') is not null
     or to_regclass('public.novel_official_tags') is not null
     or to_regclass('public.novel_custom_tags') is not null
     or to_regclass('public.novel_internal_search_attributes') is not null then
    raise exception 'classification tag objects already exist; reconcile before applying';
  end if;
end
$$;

rollback;
