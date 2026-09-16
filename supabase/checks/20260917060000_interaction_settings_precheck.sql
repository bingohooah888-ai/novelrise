-- Precheck for 20260917060000_interaction_settings.sql
-- Read-only: verifies required foundations exist and the new runtime is absent.

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'PRECHECK FAIL: public.profiles is missing';
  end if;
  if to_regclass('public.novels') is null then
    raise exception 'PRECHECK FAIL: public.novels is missing';
  end if;
  if to_regclass('public.novel_comments') is null then
    raise exception 'PRECHECK FAIL: public.novel_comments is missing';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null then
    raise exception 'PRECHECK FAIL: author_interaction_defaults already exists';
  end if;
  if to_regclass('public.novel_interaction_settings') is not null then
    raise exception 'PRECHECK FAIL: novel_interaction_settings already exists';
  end if;

  if to_regprocedure('public.novelight_author_interaction_defaults()') is not null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is not null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(text)') is not null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(text,boolean,boolean)') is not null
     or to_regprocedure('public.novelight_novel_interaction_state(text)') is not null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is not null then
    raise exception 'PRECHECK FAIL: interaction settings functions already exist';
  end if;

  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comments'
       and t.tgname = 'novelight_enforce_comment_reception'
       and not t.tgisinternal
  ) then
    raise exception 'PRECHECK FAIL: comment reception trigger already exists';
  end if;
end
$$;

select 'PRECHECK PASS: interaction settings prerequisites are ready' as result;
