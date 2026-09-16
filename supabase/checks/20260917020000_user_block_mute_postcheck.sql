-- Postcheck for 20260917020000_user_block_mute.sql

do $$
declare
  v_blocks_rls boolean;
  v_mutes_rls boolean;
begin
  if to_regclass('public.user_blocks') is null or to_regclass('public.user_mutes') is null then
    raise exception 'Block/mute tables were not created';
  end if;

  select c.relrowsecurity into v_blocks_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'user_blocks';
  select c.relrowsecurity into v_mutes_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'user_mutes';

  if not coalesce(v_blocks_rls, false) or not coalesce(v_mutes_rls, false) then
    raise exception 'RLS must be enabled on block/mute tables';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.user_blocks', 'select,insert,update,delete')
     or pg_catalog.has_table_privilege('authenticated', 'public.user_blocks', 'select,insert,update,delete')
     or pg_catalog.has_table_privilege('anon', 'public.user_mutes', 'select,insert,update,delete')
     or pg_catalog.has_table_privilege('authenticated', 'public.user_mutes', 'select,insert,update,delete') then
    raise exception 'Block/mute raw table privileges must remain revoked';
  end if;

  if to_regprocedure('public.novelight_user_relationship(uuid)') is null
     or to_regprocedure('public.novelight_set_user_block(uuid,boolean)') is null
     or to_regprocedure('public.novelight_set_user_mute(uuid,boolean)') is null
     or to_regprocedure('public.novelight_hidden_novel_ids(text[])') is null then
    raise exception 'Block/mute RPCs are missing';
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.novelight_user_relationship(uuid)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.novelight_set_user_block(uuid,boolean)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.novelight_set_user_mute(uuid,boolean)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.novelight_hidden_novel_ids(text[])', 'execute') then
    raise exception 'Anonymous users must not access personal relationship RPCs';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', 'public.novelight_user_relationship(uuid)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.novelight_set_user_block(uuid,boolean)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.novelight_set_user_mute(uuid,boolean)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.novelight_hidden_novel_ids(text[])', 'execute') then
    raise exception 'Authenticated relationship RPC grants are missing';
  end if;

  if not pg_catalog.has_function_privilege('anon', 'public.novelight_comment_feed(text,integer)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.novelight_comment_feed(text,integer)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.post_novel_comment(text,text)', 'execute') then
    raise exception 'Comment RPC grants changed unexpectedly';
  end if;
end
$$;
