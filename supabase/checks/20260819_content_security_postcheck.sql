-- NovelRise: verification after 20260819190000.
-- These queries are read-only.

-- 1. RLS must be enabled on both content tables.
select
  c.oid::regclass as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled
from pg_class c
where c.oid in ('public.novels'::regclass, 'public.episodes'::regclass)
order by c.oid::regclass::text;

-- 2. Exactly the intended SELECT policy should remain on each table.
-- No FOR ALL policy should be present.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('novels', 'episodes')
order by tablename, cmd, policyname;

-- 3. Confirm both UNIQUE constraints and the CASCADE FK.
select
  conrelid::regclass as table_name,
  conname,
  contype,
  case confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else null
  end as on_delete_action,
  convalidated,
  pg_get_constraintdef(oid, true) as definition
from pg_constraint
where conrelid in ('public.episodes'::regclass, 'public.favorites'::regclass)
  and (
    contype = 'u'
    or (contype = 'f' and confrelid = 'public.novels'::regclass)
  )
order by conrelid::regclass::text, conname;

-- 4. All of these result sets should be empty.
select user_id, novel_id, count(*) as duplicate_count
from public.favorites
group by user_id, novel_id
having count(*) > 1;

select novel_id, episode_number, count(*) as duplicate_count
from public.episodes
group by novel_id, episode_number
having count(*) > 1;

select e.id, e.novel_id
from public.episodes e
left join public.novels n on n.id = e.novel_id
where n.id is null;

-- 5. Backup metadata required for an exact rollback should exist.
select *
from novelrise_migration_backup.migration_state
where migration_id = '20260819190000';

select *
from novelrise_migration_backup.select_policies
where migration_id = '20260819190000'
order by tablename, policyname;

-- 6. Manual API tests to perform with actual anon/author/other-user JWTs:
--    anon:       published novels/episodes visible; drafts invisible
--    owner:      own published and draft novels/episodes visible
--    other user: published visible; another author's drafts invisible
-- SQL Editor usually runs as postgres and bypasses RLS, so it cannot prove these
-- user-facing cases without explicitly impersonating the relevant API roles/JWTs.

-- 7. One-screen summary.
-- PASS: expected post-migration state was confirmed.
-- WARN: migration state is valid, but manual/API verification remains.
-- FAIL: required post-migration state was not confirmed.
with
rls_state as (
  select
    coalesce(
      (select relrowsecurity
       from pg_class
       where oid = 'public.novels'::regclass),
      false
    ) as novels_enabled,
    coalesce(
      (select relrowsecurity
       from pg_class
       where oid = 'public.episodes'::regclass),
      false
    ) as episodes_enabled
),
policy_state as (
  select
    count(*) filter (
      where tablename = 'novels'
        and policyname = 'novelrise_novels_select_published_or_owner'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles @> array['anon', 'authenticated']::name[]
    ) as expected_novels_policy_count,
    count(*) filter (
      where tablename = 'episodes'
        and policyname = 'novelrise_episodes_select_published_or_novel_owner'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles @> array['anon', 'authenticated']::name[]
    ) as expected_episodes_policy_count,
    count(*) filter (
      where tablename = 'novels'
        and cmd in ('SELECT', 'ALL')
        and policyname <> 'novelrise_novels_select_published_or_owner'
    ) as unexpected_novels_read_policy_count,
    count(*) filter (
      where tablename = 'episodes'
        and cmd in ('SELECT', 'ALL')
        and policyname <> 'novelrise_episodes_select_published_or_novel_owner'
    ) as unexpected_episodes_read_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('novels', 'episodes')
),
target_columns as (
  select
    (select attnum from pg_attribute
     where attrelid = 'public.favorites'::regclass
       and attname = 'user_id' and not attisdropped) as favorite_user_attnum,
    (select attnum from pg_attribute
     where attrelid = 'public.favorites'::regclass
       and attname = 'novel_id' and not attisdropped) as favorite_novel_attnum,
    (select attnum from pg_attribute
     where attrelid = 'public.episodes'::regclass
       and attname = 'novel_id' and not attisdropped) as episode_novel_attnum,
    (select attnum from pg_attribute
     where attrelid = 'public.episodes'::regclass
       and attname = 'episode_number' and not attisdropped) as episode_number_attnum,
    (select attnum from pg_attribute
     where attrelid = 'public.novels'::regclass
       and attname = 'id' and not attisdropped) as novel_id_attnum
),
constraint_state as (
  select
    exists (
      select 1
      from pg_constraint c
      cross join target_columns tc
      where c.conrelid = 'public.favorites'::regclass
        and c.contype = 'u'
        and cardinality(c.conkey) = 2
        and c.conkey @> array[
          tc.favorite_user_attnum,
          tc.favorite_novel_attnum
        ]::smallint[]
    ) as favorites_unique_exists,
    exists (
      select 1
      from pg_constraint c
      cross join target_columns tc
      where c.conrelid = 'public.episodes'::regclass
        and c.contype = 'u'
        and cardinality(c.conkey) = 2
        and c.conkey @> array[
          tc.episode_novel_attnum,
          tc.episode_number_attnum
        ]::smallint[]
    ) as episode_number_unique_exists,
    (
      select count(*)
      from pg_constraint c
      cross join target_columns tc
      where c.conrelid = 'public.episodes'::regclass
        and c.confrelid = 'public.novels'::regclass
        and c.contype = 'f'
        and c.conkey = array[tc.episode_novel_attnum]::smallint[]
        and c.confkey = array[tc.novel_id_attnum]::smallint[]
        and c.confdeltype = 'c'
        and c.convalidated
    ) as episode_cascade_fk_count
),
data_state as (
  select
    (select count(*)
     from (
       select 1
       from public.favorites
       group by user_id, novel_id
       having count(*) > 1
     ) duplicate_groups) as favorite_duplicate_group_count,
    (select count(*)
     from (
       select 1
       from public.episodes
       group by novel_id, episode_number
       having count(*) > 1
     ) duplicate_groups) as episode_duplicate_group_count,
    (select count(*)
     from public.episodes e
     left join public.novels n on n.id = e.novel_id
     where n.id is null) as orphan_episode_count
),
backup_state as (
  select
    (select count(*)
     from novelrise_migration_backup.migration_state
     where migration_id = '20260819190000') as migration_state_count
),
checks as (
  select 10 as sort_order,
    'novelsのRLS'::text as check_name,
    case when novels_enabled then 'enabled' else 'disabled' end::text as result,
    case when novels_enabled then 'PASS' else 'FAIL' end::text as status,
    case when novels_enabled
      then 'RLSは有効です。'
      else 'RLSが無効です。公開APIからのアクセスを安全に制御できません。' end::text as detail
  from rls_state

  union all
  select 20, 'episodesのRLS',
    case when episodes_enabled then 'enabled' else 'disabled' end,
    case when episodes_enabled then 'PASS' else 'FAIL' end,
    case when episodes_enabled
      then 'RLSは有効です。'
      else 'RLSが無効です。公開APIからのアクセスを安全に制御できません。' end
  from rls_state

  union all
  select 30, 'novelsの期待SELECTポリシー',
    expected_novels_policy_count::text,
    case when expected_novels_policy_count = 1 then 'PASS' else 'FAIL' end,
    case when expected_novels_policy_count = 1
      then '期待する公開作品／作者下書きポリシーが1件あります。'
      else '期待するポリシーが正確に1件存在しません。' end
  from policy_state

  union all
  select 40, 'episodesの期待SELECTポリシー',
    expected_episodes_policy_count::text,
    case when expected_episodes_policy_count = 1 then 'PASS' else 'FAIL' end,
    case when expected_episodes_policy_count = 1
      then '期待する公開話／作品作者ポリシーが1件あります。'
      else '期待するポリシーが正確に1件存在しません。' end
  from policy_state

  union all
  select 50, 'novelsの想定外SELECT/ALLポリシー',
    unexpected_novels_read_policy_count::text,
    case when unexpected_novels_read_policy_count = 0 then 'PASS' else 'FAIL' end,
    case when unexpected_novels_read_policy_count = 0
      then '読み取り権限を広げる追加ポリシーはありません。'
      else '想定外のSELECTまたはALLポリシーを確認してください。' end
  from policy_state

  union all
  select 60, 'episodesの想定外SELECT/ALLポリシー',
    unexpected_episodes_read_policy_count::text,
    case when unexpected_episodes_read_policy_count = 0 then 'PASS' else 'FAIL' end,
    case when unexpected_episodes_read_policy_count = 0
      then '読み取り権限を広げる追加ポリシーはありません。'
      else '想定外のSELECTまたはALLポリシーを確認してください。' end
  from policy_state

  union all
  select 70, 'favorites重複防止制約',
    case when favorites_unique_exists then 'exists' else 'missing' end,
    case when favorites_unique_exists then 'PASS' else 'FAIL' end,
    case when favorites_unique_exists
      then 'UNIQUE(user_id, novel_id)相当の制約があります。'
      else '重複防止UNIQUE制約が確認できません。' end
  from constraint_state

  union all
  select 80, 'episodes話数重複防止制約',
    case when episode_number_unique_exists then 'exists' else 'missing' end,
    case when episode_number_unique_exists then 'PASS' else 'FAIL' end,
    case when episode_number_unique_exists
      then 'UNIQUE(novel_id, episode_number)相当の制約があります。'
      else '話数重複防止UNIQUE制約が確認できません。' end
  from constraint_state

  union all
  select 90, 'episodes→novels CASCADE外部キー',
    episode_cascade_fk_count::text,
    case when episode_cascade_fk_count = 1 then 'PASS' else 'FAIL' end,
    case when episode_cascade_fk_count = 1
      then '検証済みON DELETE CASCADE外部キーが1件あります。'
      else '検証済みCASCADE外部キーが正確に1件存在しません。' end
  from constraint_state

  union all
  select 100, 'favorites重複データ',
    favorite_duplicate_group_count::text,
    case when favorite_duplicate_group_count = 0 then 'PASS' else 'FAIL' end,
    case when favorite_duplicate_group_count = 0
      then '重複データはありません。'
      else '同一ユーザー・同一作品の重複があります。' end
  from data_state

  union all
  select 110, 'episodes話数重複データ',
    episode_duplicate_group_count::text,
    case when episode_duplicate_group_count = 0 then 'PASS' else 'FAIL' end,
    case when episode_duplicate_group_count = 0
      then '重複データはありません。'
      else '同一作品・同一話数の重複があります。' end
  from data_state

  union all
  select 120, '孤立episodes',
    orphan_episode_count::text,
    case when orphan_episode_count = 0 then 'PASS' else 'FAIL' end,
    case when orphan_episode_count = 0
      then '親作品のないepisodeはありません。'
      else '親作品のないepisodeがあります。' end
  from data_state

  union all
  select 130, 'ロールバック用バックアップ',
    migration_state_count::text,
    case when migration_state_count = 1 then 'PASS' else 'FAIL' end,
    case when migration_state_count = 1
      then 'migration_stateが1件保存されています。'
      else '正確なロールバックに必要なmigration_stateを確認できません。' end
  from backup_state

  union all
  select 140, '実JWTによるRLS動作確認',
    'manual test required',
    'WARN',
    'SQL Editorは通常RLSを迂回します。anon・作者・別ユーザーでAPI確認してください。'
),
final_rows as (
  select sort_order, check_name, result, status, detail
  from checks

  union all

  select
    999,
    'OVERALL',
    case
      when count(*) filter (where status = 'FAIL') > 0 then 'FAIL'
      when count(*) filter (where status = 'WARN') > 0 then 'WARN'
      else 'PASS'
    end,
    case
      when count(*) filter (where status = 'FAIL') > 0 then 'FAIL'
      when count(*) filter (where status = 'WARN') > 0 then 'WARN'
      else 'PASS'
    end,
    format(
      'FAIL=%s、WARN=%s、PASS=%s。FAILがある場合は本番利用を進めず原因を確認してください。',
      count(*) filter (where status = 'FAIL'),
      count(*) filter (where status = 'WARN'),
      count(*) filter (where status = 'PASS')
    )
  from checks
)
select check_name, result, status, detail
from final_rows
order by sort_order;
