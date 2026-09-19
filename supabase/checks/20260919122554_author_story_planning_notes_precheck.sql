do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'PRECHECK FAIL: novels table missing';
  end if;
  if to_regclass('public.novel_characters') is null then
    raise exception 'PRECHECK FAIL: canonical character registry missing';
  end if;

  if to_regclass('public.novel_private_story_notes') is not null
     or to_regprocedure('public.novelight_private_story_notes(bigint)') is not null
     or to_regprocedure('public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)') is not null
     or to_regprocedure('public.novelight_delete_private_story_note(bigint)') is not null then
    raise exception 'PRECHECK FAIL: B #23 runtime already exists';
  end if;

  raise notice 'PRECHECK PASS: B #23 dependencies ready and runtime absent';
end
$$;