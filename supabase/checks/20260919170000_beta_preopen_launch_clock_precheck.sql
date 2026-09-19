\set ON_ERROR_STOP on

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)',
    'public.novelight_neutral_search(text,text,text,integer,integer)',
    'public.record_novel_impressions_v2(text,text[],text)',
    'private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required launch-clock function is missing: %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'first_published_at'
  ) then
    raise exception 'novels.first_published_at is missing';
  end if;
end
$$;
