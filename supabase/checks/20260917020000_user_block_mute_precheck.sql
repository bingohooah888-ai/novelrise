-- Precheck for 20260917020000_user_block_mute.sql

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null then
    raise exception 'Required NOVELIGHT foundations are missing';
  end if;

  if to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null then
    raise exception 'Current comment RPCs are missing';
  end if;

  if to_regclass('public.user_blocks') is not null
     or to_regclass('public.user_mutes') is not null
     or to_regprocedure('public.novelight_user_relationship(uuid)') is not null
     or to_regprocedure('public.novelight_set_user_block(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_set_user_mute(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_hidden_novel_ids(text[])') is not null then
    raise exception 'Block/mute objects already exist; reconcile before applying migration';
  end if;
end
$$;
