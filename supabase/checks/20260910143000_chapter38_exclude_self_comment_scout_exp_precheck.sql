do $$
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novels') is null then
    raise exception 'Chapter 38 comment tables are missing';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.delete_novel_comment(uuid)') is null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is null then
    raise exception 'Chapter 38 comment RPC contract is incomplete';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
       and x.rule_version <> 'beta-v1'
  ) then
    raise exception 'Unexpected non-beta-v1 comment XP requires manual reconciliation';
  end if;
end
$$;
