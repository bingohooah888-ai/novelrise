-- NOVELIGHT public official thumbnail lookup precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'public.novels is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'id'
      and data_type = 'bigint'
  ) then
    raise exception 'public.novels.id must be bigint';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'status'
      and data_type = 'text'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'thumbnail_url'
      and data_type = 'text'
  ) then
    raise exception 'public.novels status/thumbnail_url prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_public_thumbnail_urls(text[])') is not null then
    raise exception 'public thumbnail lookup already exists; inspect drift before applying';
  end if;
end
$$;

select 'PASS: public thumbnail lookup precheck' as result;
