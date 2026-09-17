do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if to_regclass('public.author_work_export_audit') is not null then
    raise exception 'public.author_work_export_audit already exists; stop and inspect before applying';
  end if;

  if to_regprocedure('public.novelight_authorize_work_export(bigint,text)') is not null then
    raise exception 'novelight_authorize_work_export already exists; stop and inspect before applying';
  end if;
end
$$;
