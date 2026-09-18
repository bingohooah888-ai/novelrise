\set ON_ERROR_STOP on

do $$
declare
  v_trigger text;
begin
  if to_regclass('public.novel_characters') is null
     or to_regclass('public.novel_character_episode_states') is null then
    raise exception 'Character appearance tables are missing';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='novel_characters'
      and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='novel_character_episode_states'
      and c.relrowsecurity
  ) then
    raise exception 'Character appearance raw tables must have RLS enabled';
  end if;

  if has_table_privilege('anon','public.novel_characters','SELECT')
     or has_table_privilege('authenticated','public.novel_characters','SELECT')
     or has_table_privilege('service_role','public.novel_characters','SELECT')
     or has_table_privilege('anon','public.novel_character_episode_states','SELECT')
     or has_table_privilege('authenticated','public.novel_character_episode_states','SELECT')
     or has_table_privilege('service_role','public.novel_character_episode_states','SELECT') then
    raise exception 'Raw character appearance tables are client-accessible';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_set_character_episode_override(bigint,bigint,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_set_character_episode_override(bigint,bigint,text)',
       'EXECUTE'
     ) then
    raise exception 'Owner character mutation RPC grants are invalid';
  end if;

  if not has_function_privilege(
       'anon',
       'public.novelight_character_feed(bigint)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_character_feed(bigint)',
       'EXECUTE'
     ) then
    raise exception 'Spoiler-safe character feed grants are incomplete';
  end if;

  if has_function_privilege(
       'anon',
       'public._novelight_rescan_character(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._novelight_rescan_character(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public._novelight_rescan_character(bigint)',
       'EXECUTE'
     ) then
    raise exception 'Internal character rescan is externally executable';
  end if;

  select pg_get_triggerdef(t.oid)
    into v_trigger
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname='episodes'
     and t.tgname='novelight_refresh_episode_character_appearances'
     and not t.tgisinternal;

  if v_trigger is null
     or position('AFTER INSERT OR UPDATE OF content, novel_id' in v_trigger)=0 then
    raise exception 'Episode character refresh trigger is missing or too broad';
  end if;

  if to_regprocedure('public.novelight_author_character_list(bigint)') is null
     or to_regprocedure('public.novelight_episode_character_editor(bigint)') is null
     or to_regprocedure('public.novelight_delete_character(bigint)') is null then
    raise exception 'Character appearance RPC surface is incomplete';
  end if;
end
$$;

select 'POSTCHECK PASS: character appearance is private, owner-controlled, trigger-backed, and spoiler-safe' as result;
