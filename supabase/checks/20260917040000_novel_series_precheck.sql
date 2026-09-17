\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'Required public.novels table is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass) then
    raise exception 'RLS must be enabled on public.novels before series migration';
  end if;

  if to_regclass('public.novel_series') is not null
     or to_regclass('public.novel_series_items') is not null then
    raise exception 'Novel series tables already exist';
  end if;

  if to_regprocedure('public.novelight_set_series_items(bigint,bigint[])') is not null
     or to_regprocedure('public.novelight_public_series_context(bigint)') is not null then
    raise exception 'Novel series RPC already exists';
  end if;
end
$$;
