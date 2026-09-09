do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Chapter 38 SCOUT and novel foundations are required';
  end if;

  if to_regclass('public.novel_comments') is not null then
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'id'
         and data_type = 'uuid'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'novel_id'
         and data_type = 'bigint'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'user_id'
         and data_type = 'uuid'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'body'
         and data_type = 'text'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'created_at'
         and data_type = 'timestamp with time zone'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'deleted_at'
         and data_type = 'timestamp with time zone'
    ) then
      raise exception 'Existing novel_comments schema requires manual reconciliation';
    end if;
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is not null
     or to_regprocedure('public.delete_novel_comment(uuid)') is not null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is not null then
    raise exception 'Comment runtime is already installed';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
  ) then
    raise exception 'Existing comment SCOUT EXP requires manual reconciliation';
  end if;
end
$$;
