-- NovelRise: content security migration preflight (READ ONLY)
-- Run this file first in the Supabase SQL editor. It must not modify data.

-- 1. Server and table/RLS overview.
select version() as postgres_version;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'novels', 'episodes', 'favorites')
order by c.relname;

-- 2. Columns used by this migration. Confirm types and nullability.
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'novels' and column_name in ('id', 'user_id', 'status'))
    or
    (table_name = 'episodes' and column_name in
      ('id', 'novel_id', 'user_id', 'episode_number', 'status'))
    or
    (table_name = 'favorites' and column_name in ('id', 'user_id', 'novel_id'))
  )
order by table_name, ordinal_position;

-- 3. Existing policies. Pay special attention to FOR ALL policies: the
-- migration intentionally aborts if one exists on novels or episodes.
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
  and tablename in ('novels', 'episodes', 'favorites')
order by tablename, cmd, policyname;

-- 4. Existing constraints and foreign-key delete actions.
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  case confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else null
  end as on_delete_action,
  convalidated as validated,
  pg_get_constraintdef(oid, true) as definition
from pg_constraint
where conrelid in ('public.novels'::regclass,
                   'public.episodes'::regclass,
                   'public.favorites'::regclass)
order by conrelid::regclass::text, conname;

-- 5. Values that would violate the intended visibility rules.
select 'novels.status' as check_name, status, count(*) as row_count
from public.novels
group by status
order by status;

select 'episodes.status' as check_name, status, count(*) as row_count
from public.episodes
group by status
order by status;

select 'novels with null security columns' as check_name, count(*) as problem_count
from public.novels
where user_id is null or status is null;

select 'episodes with null security columns' as check_name, count(*) as problem_count
from public.episodes
where novel_id is null
   or user_id is null
   or episode_number is null
   or status is null;

select 'favorites with null key columns' as check_name, count(*) as problem_count
from public.favorites
where user_id is null or novel_id is null;

-- 6. Duplicate rows that would block UNIQUE constraints.
select
  user_id,
  novel_id,
  count(*) as duplicate_count,
  array_agg(id order by id) as row_ids
from public.favorites
group by user_id, novel_id
having count(*) > 1
order by duplicate_count desc, user_id, novel_id;

select
  novel_id,
  episode_number,
  count(*) as duplicate_count,
  array_agg(id order by id) as row_ids
from public.episodes
group by novel_id, episode_number
having count(*) > 1
order by duplicate_count desc, novel_id, episode_number;

-- 7. Orphans and ownership inconsistencies.
select e.id, e.novel_id, e.user_id
from public.episodes e
left join public.novels n on n.id = e.novel_id
where n.id is null
order by e.id;

select f.id, f.novel_id, f.user_id
from public.favorites f
left join public.novels n on n.id = f.novel_id
where n.id is null
order by f.id;

-- The SELECT policy uses the novel owner as the canonical episode owner.
-- Any rows returned here should be investigated before migration.
select
  e.id as episode_id,
  e.novel_id,
  e.user_id as episode_user_id,
  n.user_id as novel_user_id
from public.episodes e
join public.novels n on n.id = e.novel_id
where e.user_id is distinct from n.user_id
order by e.id;

-- 8. A non-CASCADE favorites -> novels FK may still prevent novel deletion.
select
  c.conname,
  case c.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end as on_delete_action,
  pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.contype = 'f'
  and c.conrelid = 'public.favorites'::regclass
  and c.confrelid = 'public.novels'::regclass;

-- 9. Overall decision table.
-- PASS: no action is needed for this check.
-- WARN: the migration can proceed, but the detail should be reviewed.
-- FAIL: do not run the migration until the problem is resolved.
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
for_all_counts as (
  select
    count(*) filter (where tablename = 'novels') as novels_count,
    count(*) filter (where tablename = 'episodes') as episodes_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('novels', 'episodes')
    and cmd = 'ALL'
),
favorite_duplicate_groups as (
  select count(*) as group_count,
         coalesce(sum(duplicate_count - 1), 0) as excess_row_count
  from (
    select count(*) as duplicate_count
    from public.favorites
    group by user_id, novel_id
    having count(*) > 1
  ) duplicates
),
episode_duplicate_groups as (
  select count(*) as group_count,
         coalesce(sum(duplicate_count - 1), 0) as excess_row_count
  from (
    select count(*) as duplicate_count
    from public.episodes
    group by novel_id, episode_number
    having count(*) > 1
  ) duplicates
),
problem_counts as (
  select
    (select count(*)
     from public.episodes e
     left join public.novels n on n.id = e.novel_id
     where n.id is null) as orphan_episode_count,
    (select count(*)
     from public.favorites f
     left join public.novels n on n.id = f.novel_id
     where n.id is null) as orphan_favorite_count,
    (select count(*)
     from public.episodes e
     join public.novels n on n.id = e.novel_id
     where e.user_id is distinct from n.user_id) as owner_mismatch_count,
    (select count(*)
     from public.novels
     where user_id is null or status is null) as novels_null_count,
    (select count(*)
     from public.episodes
     where user_id is null
        or novel_id is null
        or episode_number is null
        or status is null) as episodes_null_count,
    (select count(*)
     from public.favorites
     where user_id is null or novel_id is null) as favorites_null_count,
    (select count(*)
     from public.novels
     where status is not null
       and status not in ('published', 'draft')) as novels_invalid_status_count,
    (select count(*)
     from public.episodes
     where status is not null
       and status not in ('published', 'draft')) as episodes_invalid_status_count
),
target_columns as (
  select
    (select attnum
     from pg_attribute
     where attrelid = 'public.episodes'::regclass
       and attname = 'novel_id'
       and not attisdropped) as episode_novel_attnum,
    (select attnum
     from pg_attribute
     where attrelid = 'public.favorites'::regclass
       and attname = 'novel_id'
       and not attisdropped) as favorite_novel_attnum,
    (select attnum
     from pg_attribute
     where attrelid = 'public.novels'::regclass
       and attname = 'id'
       and not attisdropped) as novel_id_attnum
),
episode_fk_state as (
  select
    count(*) as fk_count,
    count(*) filter (where c.confdeltype = 'c') as cascade_count,
    coalesce(
      string_agg(
        format(
          '%I: %s',
          c.conname,
          case c.confdeltype
            when 'a' then 'NO ACTION'
            when 'r' then 'RESTRICT'
            when 'c' then 'CASCADE'
            when 'n' then 'SET NULL'
            when 'd' then 'SET DEFAULT'
            else 'UNKNOWN'
          end
        ),
        ', ' order by c.conname
      ),
      '外部キーなし'
    ) as detail
  from pg_constraint c
  cross join target_columns tc
  where c.contype = 'f'
    and c.conrelid = 'public.episodes'::regclass
    and c.confrelid = 'public.novels'::regclass
    and c.conkey = array[tc.episode_novel_attnum]::smallint[]
    and c.confkey = array[tc.novel_id_attnum]::smallint[]
),
favorite_fk_state as (
  select
    count(*) as fk_count,
    count(*) filter (where c.confdeltype = 'c') as cascade_count,
    coalesce(
      string_agg(
        format(
          '%I: %s',
          c.conname,
          case c.confdeltype
            when 'a' then 'NO ACTION'
            when 'r' then 'RESTRICT'
            when 'c' then 'CASCADE'
            when 'n' then 'SET NULL'
            when 'd' then 'SET DEFAULT'
            else 'UNKNOWN'
          end
        ),
        ', ' order by c.conname
      ),
      '外部キーなし'
    ) as detail
  from pg_constraint c
  cross join target_columns tc
  where c.contype = 'f'
    and c.conrelid = 'public.favorites'::regclass
    and c.confrelid = 'public.novels'::regclass
    and c.conkey = array[tc.favorite_novel_attnum]::smallint[]
    and c.confkey = array[tc.novel_id_attnum]::smallint[]
),
checks as (
  select
    10 as sort_order,
    'novelsのRLS有効状態'::text as check_name,
    case when novels_enabled then 'enabled' else 'disabled' end::text as result,
    case when novels_enabled then 'PASS' else 'WARN' end::text as status,
    case
      when novels_enabled then 'RLSは有効です。'
      else '現在RLSは無効です。migrationで有効化されます。'
    end::text as detail
  from rls_state

  union all
  select
    20,
    'episodesのRLS有効状態',
    case when episodes_enabled then 'enabled' else 'disabled' end,
    case when episodes_enabled then 'PASS' else 'WARN' end,
    case
      when episodes_enabled then 'RLSは有効です。'
      else '現在RLSは無効です。migrationで有効化されます。'
    end
  from rls_state

  union all
  select
    30,
    'novelsのFOR ALLポリシー件数',
    novels_count::text,
    case when novels_count = 0 then 'PASS' else 'FAIL' end,
    case
      when novels_count = 0 then 'FOR ALLポリシーはありません。'
      else 'migrationは安全のため中断します。既存ポリシーの分割・確認が必要です。'
    end
  from for_all_counts

  union all
  select
    40,
    'episodesのFOR ALLポリシー件数',
    episodes_count::text,
    case when episodes_count = 0 then 'PASS' else 'FAIL' end,
    case
      when episodes_count = 0 then 'FOR ALLポリシーはありません。'
      else 'migrationは安全のため中断します。既存ポリシーの分割・確認が必要です。'
    end
  from for_all_counts

  union all
  select
    50,
    'favorites重複件数',
    group_count::text,
    case when group_count = 0 then 'PASS' else 'FAIL' end,
    format('重複グループ数=%s、余分な行数=%s', group_count, excess_row_count)
  from favorite_duplicate_groups

  union all
  select
    60,
    'episodesの同一作品・同一話数の重複件数',
    group_count::text,
    case when group_count = 0 then 'PASS' else 'FAIL' end,
    format('重複グループ数=%s、余分な行数=%s', group_count, excess_row_count)
  from episode_duplicate_groups

  union all
  select 70, '孤立episodes件数', orphan_episode_count::text,
    case when orphan_episode_count = 0 then 'PASS' else 'FAIL' end,
    case when orphan_episode_count = 0
      then '親作品のないepisodeはありません。'
      else '親作品のないepisodeを解消してからmigrationを実行してください。' end
  from problem_counts

  union all
  select 80, '孤立favorites件数', orphan_favorite_count::text,
    case when orphan_favorite_count = 0 then 'PASS' else 'FAIL' end,
    case when orphan_favorite_count = 0
      then '親作品のないfavoriteはありません。'
      else '親作品のないfavoriteを確認・解消してください。' end
  from problem_counts

  union all
  select 90, 'episodes.user_idとnovels.user_idの不一致件数', owner_mismatch_count::text,
    case when owner_mismatch_count = 0 then 'PASS' else 'FAIL' end,
    case when owner_mismatch_count = 0
      then 'episode所有者と作品所有者は一致しています。'
      else 'migrationは安全のため中断します。所有者データの確認が必要です。' end
  from problem_counts

  union all
  select 100, 'novelsのNULL所有者・status件数', novels_null_count::text,
    case when novels_null_count = 0 then 'PASS' else 'FAIL' end,
    case when novels_null_count = 0
      then 'NULLのセキュリティ列はありません。'
      else 'user_idまたはstatusがNULLの作品を解消してください。' end
  from problem_counts

  union all
  select 110, 'episodesのNULL所有者・novel_id・episode_number・status件数', episodes_null_count::text,
    case when episodes_null_count = 0 then 'PASS' else 'FAIL' end,
    case when episodes_null_count = 0
      then 'NULLのセキュリティ列はありません。'
      else 'NULLの所有者・作品ID・話数・statusを解消してください。' end
  from problem_counts

  union all
  select 120, 'favoritesのNULL user_id・novel_id件数', favorites_null_count::text,
    case when favorites_null_count = 0 then 'PASS' else 'FAIL' end,
    case when favorites_null_count = 0
      then 'NULLのキー列はありません。'
      else 'NULLのuser_idまたはnovel_idを解消してください。' end
  from problem_counts

  union all
  select 130, 'novelsの不正status件数', novels_invalid_status_count::text,
    case when novels_invalid_status_count = 0 then 'PASS' else 'FAIL' end,
    case when novels_invalid_status_count = 0
      then 'statusはpublished/draftだけです。'
      else 'published/draft以外のstatusを解消してください。' end
  from problem_counts

  union all
  select 140, 'episodesの不正status件数', episodes_invalid_status_count::text,
    case when episodes_invalid_status_count = 0 then 'PASS' else 'FAIL' end,
    case when episodes_invalid_status_count = 0
      then 'statusはpublished/draftだけです。'
      else 'published/draft以外のstatusを解消してください。' end
  from problem_counts

  union all
  select
    150,
    'episodes→novels外部キーのON DELETE状態',
    detail,
    case
      when fk_count > 1 then 'FAIL'
      when fk_count = 1 and cascade_count = 1 then 'PASS'
      else 'WARN'
    end,
    case
      when fk_count > 1 then '対象外部キーが複数あります。migrationは中断します。'
      when fk_count = 0 then 'migrationでON DELETE CASCADE付き外部キーが追加されます。'
      when cascade_count = 1 then '作品削除時にepisodesも安全に削除されます。'
      else 'migrationでON DELETE CASCADEへ置き換えられます。'
    end
  from episode_fk_state

  union all
  select
    160,
    'favorites→novels外部キーのON DELETE状態',
    detail,
    case
      when fk_count > 1 then 'FAIL'
      when fk_count = 1 and cascade_count = 1 then 'PASS'
      else 'WARN'
    end,
    case
      when fk_count > 1 then '対象外部キーが複数あります。手動確認が必要です。'
      when fk_count = 0 then '外部キーがありません。今回のmigrationでは変更されません。'
      when cascade_count = 1 then '作品削除時にfavoritesも削除されます。'
      else '作品削除を妨げる可能性があります。今回のmigrationでは変更されません。'
    end
  from favorite_fk_state
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
      'FAIL=%s、WARN=%s、PASS=%s。FAILがある場合はmigrationを実行しないでください。',
      count(*) filter (where status = 'FAIL'),
      count(*) filter (where status = 'WARN'),
      count(*) filter (where status = 'PASS')
    )
  from checks
)
select check_name, result, status, detail
from final_rows
order by sort_order;
