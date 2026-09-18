#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

host="${PGHOST:-127.0.0.1}"
user="${PGUSER:-postgres}"
replay_db="${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}"

ADMIN=(psql -h "$host" -U "$user" -d postgres -v ON_ERROR_STOP=1)
REPLAY=(psql -h "$host" -U "$user" -d "$replay_db" -v ON_ERROR_STOP=1)

echo '::group::Prepare clean migration replay database'
"${ADMIN[@]}" -c "drop database if exists ${replay_db} with (force);"
"${ADMIN[@]}" -c "create database ${replay_db};"
echo '::endgroup::'

echo '::group::Install minimal Supabase auth compatibility fixture'
"${REPLAY[@]}" <<'SQL'
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create table auth.users (
  id uuid primary key,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL
echo '::endgroup::'

for migration in supabase/migrations/*.sql; do
  echo "::group::Replay $migration"
  "${REPLAY[@]}" -f "$migration"
  echo '::endgroup::'
done

echo '::group::Verify replay reached the current schema contract'
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.light_seeds') is null
     or to_regclass('public.novel_exposure_events') is null
     or to_regclass('public.founding_authors') is null
     or to_regclass('public.billing_checkout_attempts') is null then
    raise exception 'Fresh migration replay is missing one or more required tables';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'stripe_subscription_id'
  ) then
    raise exception 'Fresh migration replay did not reach Stripe subscription schema';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'first_published_at'
  ) then
    raise exception 'Fresh migration replay did not reach first-publication schema';
  end if;
end
$$;
SQL
echo '::endgroup::'

echo '::group::Verify atomic episode publication behavior'
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_postcheck.sql
"${REPLAY[@]}" -f tests/rls/atomic-episode-publish.sql
echo '::endgroup::'

echo '::group::Verify atomic episode publication rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260830163000_atomic_episode_publish_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure(
    'public.novelight_publish_episode_atomic(bigint,bigint,text,text)'
  ) is not null then
    raise exception 'Atomic episode publish rollback left the RPC behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260830163000_atomic_episode_publish.sql
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Checkout attempt reservation behavior'
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Checkout attempt reservation rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260830214000_checkout_attempt_reservations_rollback.sql
"${REPLAY[@]}" -f tests/rls/checkout-attempt-reservations-rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260830214000_checkout_attempt_reservations.sql
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_postcheck.sql
echo '::endgroup::'

echo '::group::Verify LIGHT SEED public feed behavior'
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-seed-public-feed.sql
echo '::endgroup::'

echo '::group::Verify LIGHT SEED public feed rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908120000_light_seed_public_feed_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('public.novelight_light_seed_feed(integer,integer)') is not null then
    raise exception 'LIGHT SEED public feed rollback left the RPC behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260908120000_light_seed_public_feed.sql
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_postcheck.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS runtime repair'
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-runtime.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS runtime repair rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908153000_fix_light_analytics_runtime_ordering_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
declare
  v_definition text;
begin
  select lower(pg_get_functiondef('public.novelight_author_exposure_funnel_v2(integer)'::regprocedure))
    into v_definition;

  if position('order by impressions desc nulls last, novel_id nulls last' in v_definition) = 0 then
    raise exception 'LIGHT ANALYTICS repair rollback did not restore the preceding implementation';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260908153000_fix_light_analytics_runtime_ordering.sql
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-runtime.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS visual trend behavior'
"${REPLAY[@]}" -f supabase/checks/20260908172000_light_analytics_visual_trends_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-visual-trends.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS visual trend rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908172000_light_analytics_visual_trends_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('public.novelight_author_analytics_timeseries(integer)') is not null then
    raise exception 'LIGHT ANALYTICS visual trend rollback left the RPC behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260908172000_light_analytics_visual_trends_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260908172000_light_analytics_visual_trends.sql
"${REPLAY[@]}" -f supabase/checks/20260908172000_light_analytics_visual_trends_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-visual-trends.sql
echo '::endgroup::'

echo '::group::Verify Chapter 38 comment SCOUT EXP behavior'
"${REPLAY[@]}" -f supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_postcheck.sql
"${REPLAY[@]}" -f supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_postcheck.sql
"${REPLAY[@]}" -f tests/rls/comment-scout-exp-foundation.sql
"${REPLAY[@]}" -f tests/rls/comment-scout-exp-self-exclusion.sql
echo '::endgroup::'

echo '::group::Verify Chapter 38 self-comment exclusion rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260910143000_chapter38_exclude_self_comment_scout_exp_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_postcheck.sql
"${REPLAY[@]}" -f supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260910143000_chapter38_exclude_self_comment_scout_exp.sql
"${REPLAY[@]}" -f supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Chapter 38 comment SCOUT EXP rollback and replay'
"${REPLAY[@]}" -f supabase/rollback/20260910143000_chapter38_exclude_self_comment_scout_exp_rollback.sql
"${REPLAY[@]}" -f supabase/rollback/20260910070000_chapter38_comment_scout_exp_foundation_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.novel_comments') is null then
    raise exception 'Comment rollback must preserve stored comment evidence';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is not null
     or to_regprocedure('public.delete_novel_comment(uuid)') is not null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is not null then
    raise exception 'Comment rollback left client RPCs behind';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
       and x.rule_version = 'beta-v1'
  ) then
    raise exception 'Comment rollback left beta-v1 derived XP behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260910070000_chapter38_comment_scout_exp_foundation.sql
"${REPLAY[@]}" -f supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_postcheck.sql
"${REPLAY[@]}" -f supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260910143000_chapter38_exclude_self_comment_scout_exp.sql
"${REPLAY[@]}" -f supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_postcheck.sql
echo '::endgroup::'

echo '::group::Restore post-Chapter-38 user safety comment runtime'
"${REPLAY[@]}" -f supabase/rollback/20260917020000_user_block_mute_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260917020000_user_block_mute_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260917020000_user_block_mute.sql
"${REPLAY[@]}" -f supabase/checks/20260917020000_user_block_mute_postcheck.sql
echo '::endgroup::'

echo '::group::Verify scheduled episode publication behavior'
"${REPLAY[@]}" -f supabase/checks/20260916100000_episode_scheduled_publication_postcheck.sql
"${REPLAY[@]}" -f tests/rls/episode-scheduled-publication.sql
echo '::endgroup::'

echo '::group::Verify scheduled episode publication rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260916100000_episode_scheduled_publication_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
  ) then
    raise exception 'Scheduled publication rollback left the schedule column behind';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is not null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is not null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is not null then
    raise exception 'Scheduled publication rollback left one or more new RPCs behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260916100000_episode_scheduled_publication_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260916100000_episode_scheduled_publication.sql
"${REPLAY[@]}" -f supabase/checks/20260916100000_episode_scheduled_publication_postcheck.sql
echo '::endgroup::'

echo '::group::Verify author follow notification behavior'
"${REPLAY[@]}" -f supabase/checks/20260918140022_author_follow_notifications_postcheck.sql
"${REPLAY[@]}" -f tests/rls/author-follow-notifications.sql
echo '::endgroup::'

echo '::group::Verify author follow notification rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918140022_author_follow_notifications_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.author_follows') is not null
     or to_regclass('public.author_follow_events') is not null
     or to_regprocedure('public.novelight_author_follow_state(uuid)') is not null
     or to_regprocedure('public.novelight_followed_author_updates(integer)') is not null then
    raise exception 'Author follow rollback left B #9 objects behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918140022_author_follow_notifications_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918140022_author_follow_notifications.sql
"${REPLAY[@]}" -f supabase/checks/20260918140022_author_follow_notifications_postcheck.sql
"${REPLAY[@]}" -f tests/rls/author-follow-notifications.sql
echo '::endgroup::'

echo '::group::Verify private reader bookshelf behavior'
"${REPLAY[@]}" -f supabase/checks/20260918152523_reader_bookshelf_organization_postcheck.sql
"${REPLAY[@]}" -f tests/rls/reader-bookshelf-organization.sql
echo '::endgroup::'

echo '::group::Verify private reader bookshelf rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918152523_reader_bookshelf_organization_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.reader_bookshelf_entries') is not null
     or to_regprocedure('public.novelight_touch_reader_bookshelf_entry()') is not null then
    raise exception 'Reader bookshelf rollback left B #10 objects behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918152523_reader_bookshelf_organization_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918152523_reader_bookshelf_organization.sql
"${REPLAY[@]}" -f supabase/checks/20260918152523_reader_bookshelf_organization_postcheck.sql
"${REPLAY[@]}" -f tests/rls/reader-bookshelf-organization.sql
echo '::endgroup::'

echo '::group::Verify B #11 interaction reception behavior'
"${REPLAY[@]}" -f supabase/checks/20260918164000_interaction_reception_settings_postcheck.sql
"${REPLAY[@]}" -f tests/rls/interaction-reception-settings.sql
echo '::endgroup::'

echo '::group::Verify B #11 interaction reception rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918164000_interaction_reception_settings_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_comment_reception_settings') is not null
     or to_regprocedure('public.novelight_author_interaction_defaults()') is not null
     or to_regprocedure('public.novelight_novel_comment_reception_state(bigint)') is not null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is not null
     or exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'novel_typo_report_settings'
          and column_name = 'inherits_author_default'
     ) then
    raise exception 'B #11 rollback left interaction reception objects behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918164000_interaction_reception_settings_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918164000_interaction_reception_settings.sql
"${REPLAY[@]}" -f supabase/checks/20260918164000_interaction_reception_settings_postcheck.sql
"${REPLAY[@]}" -f tests/rls/interaction-reception-settings.sql
echo '::endgroup::'

echo '::group::Verify B #13 episode schedule batch management'
"${REPLAY[@]}" -f supabase/checks/20260918180500_episode_schedule_batch_management_postcheck.sql
"${REPLAY[@]}" -f tests/rls/episode-schedule-batch-management.sql
echo '::endgroup::'

echo '::group::Verify B #13 schedule batch rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918180500_episode_schedule_batch_management_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('public.novelight_batch_manage_episode_schedules(bigint,jsonb)') is not null then
    raise exception 'B #13 rollback left the batch schedule RPC behind';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
  ) then
    raise exception 'B #13 rollback disturbed the existing schedule foundation';
  end if;

  if to_regprocedure('public.novelight_publish_due_episode_schedules()') is null then
    raise exception 'B #13 rollback removed the existing due scheduler';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918180500_episode_schedule_batch_management_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918180500_episode_schedule_batch_management.sql
"${REPLAY[@]}" -f supabase/checks/20260918180500_episode_schedule_batch_management_postcheck.sql
"${REPLAY[@]}" -f tests/rls/episode-schedule-batch-management.sql
echo '::endgroup::'

echo '::group::Verify B #14 author comment moderation'
"${REPLAY[@]}" -f supabase/rollback/20260918192000_comment_author_moderation_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260918192000_comment_author_moderation_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918192000_comment_author_moderation.sql
"${REPLAY[@]}" -f supabase/checks/20260918192000_comment_author_moderation_postcheck.sql
"${REPLAY[@]}" -f tests/rls/comment-author-moderation.sql
echo '::endgroup::'

echo '::group::Verify B #14 comment moderation rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918192000_comment_author_moderation_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.novel_comment_moderation_events') is not null
     or to_regprocedure('public.novelight_set_comment_pin(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is not null
     or to_regprocedure('public.novelight_set_comment_author_reply(uuid,text)') is not null
     or exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'novel_comments'
          and column_name in (
            'author_hidden_at',
            'author_hidden_reason',
            'pinned_at',
            'author_reply_body',
            'author_reply_at',
            'author_reply_updated_at'
          )
     ) then
    raise exception 'B #14 rollback left moderation objects behind';
  end if;

  if to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.delete_novel_comment(uuid)') is null then
    raise exception 'B #14 rollback disturbed the existing comment foundation';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918192000_comment_author_moderation_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918192000_comment_author_moderation.sql
"${REPLAY[@]}" -f supabase/checks/20260918192000_comment_author_moderation_postcheck.sql
echo '::endgroup::'

echo '::group::Verify character appearance behavior'
"${REPLAY[@]}" -f supabase/checks/20260918211545_character_appearance_list_postcheck.sql
"${REPLAY[@]}" -f tests/rls/character-appearance-list.sql
echo '::endgroup::'

echo '::group::Verify character appearance rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918211545_character_appearance_list_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.novel_characters') is not null
     or to_regclass('public.novel_character_episode_states') is not null
     or to_regprocedure('public.novelight_character_feed(bigint)') is not null
     or to_regprocedure('public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)') is not null then
    raise exception 'Character appearance rollback left feature objects behind';
  end if;

  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null then
    raise exception 'Character appearance rollback disturbed existing content foundations';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918211545_character_appearance_list_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918211545_character_appearance_list.sql
"${REPLAY[@]}" -f supabase/checks/20260918211545_character_appearance_list_postcheck.sql
"${REPLAY[@]}" -f tests/rls/character-appearance-list.sql
echo '::endgroup::'

echo '::group::Verify B #15 comment spoiler display'
"${REPLAY[@]}" -f supabase/rollback/20260918221621_comment_spoiler_display_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260918221621_comment_spoiler_display_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918221621_comment_spoiler_display.sql
"${REPLAY[@]}" -f supabase/checks/20260918221621_comment_spoiler_display_postcheck.sql
"${REPLAY[@]}" -f tests/rls/comment-spoiler-display.sql
echo '::endgroup::'

echo '::group::Verify B #15 comment spoiler rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260918221621_comment_spoiler_display_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_comments'
       and column_name = 'is_spoiler'
  ) or to_regprocedure(
    'public.novelight_post_novel_comment(text,text,boolean)'
  ) is not null then
    raise exception 'B #15 rollback left spoiler objects behind';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is null then
    raise exception 'B #15 rollback disturbed the B #14 comment foundation';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260918221621_comment_spoiler_display_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260918221621_comment_spoiler_display.sql
"${REPLAY[@]}" -f supabase/checks/20260918221621_comment_spoiler_display_postcheck.sql
echo '::endgroup::'

echo 'Fresh NOVELIGHT migration replay passed.'