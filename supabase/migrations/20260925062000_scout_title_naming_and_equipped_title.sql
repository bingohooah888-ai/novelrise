-- Reconcile SCOUT RECORD user-facing terminology with the 2026-09-24 MASTER naming decisions.
-- Internal badge identifiers and RPC names remain unchanged for compatibility.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260925062000'));

do $$
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null then
    raise exception 'SCOUT title reconciliation requires deployed badge tables';
  end if;

  if not exists (
    select 1
    from pg_proc
    where proname = 'novelight_set_scout_badge_visibility'
  ) then
    raise exception 'SCOUT title reconciliation requires visibility RPC';
  end if;
end
$$;

with title_map(badge_id, display_name) as (
  values
    ('reader_read_001', 'FIRST PAGE'),
    ('reader_read_005', 'PAGEWALKER'),
    ('reader_read_010', 'STORYSEEKER'),
    ('reader_read_025', 'LOREBOUND'),
    ('reader_rating_001', 'STAR TOUCH'),
    ('reader_rating_005', 'STARHAND'),
    ('reader_rating_010', 'STARWEAVER'),
    ('reader_comment_001', 'FIRST ECHO'),
    ('reader_comment_005', 'ECHOBEARER'),
    ('reader_comment_010', 'VOICEKEEPER'),
    ('reader_seed_001', 'SEEDBEARER'),
    ('reader_seed_003', 'SEEDSOWER'),
    ('reader_seed_005', 'SEEDBINDER'),
    ('reader_seed_010', 'SEEDKEEPER'),
    ('reader_bronze_seed_001', 'BRONZE VOW'),
    ('reader_silver_seed_001', 'SILVER VOW'),
    ('reader_gold_seed_001', 'GOLDEN VOW'),
    ('reader_discovery_plus2_001', 'TRACEFINDER'),
    ('reader_discovery_plus2_002', 'VEILSEEKER'),
    ('reader_discovery_plus2_003', 'PATHBREAKER'),
    ('reader_new_author_005', 'DAWNSEEKER'),
    ('reader_new_author_010', 'DAWNWALKER'),
    ('reader_genre_003', 'REALMTOUCH'),
    ('reader_genre_005', 'REALMWALKER'),
    ('reader_new_work_005', 'FRESH INK'),
    ('reader_low_rank_005', 'SHADOWSEEKER'),
    ('reader_level_005', 'AWAKENED'),
    ('reader_level_010', 'ASCENDANT'),
    ('reader_level_020', 'EXALTED'),
    ('reader_active_days_007', 'SEVEN NIGHTS'),
    ('reader_read_050', 'CHRONICLE WALKER'),
    ('reader_read_100', 'ARCHIVE SEEKER'),
    ('reader_read_200', 'LOREKEEPER'),
    ('reader_read_300', 'GRAND ARCHIVIST'),
    ('reader_rating_025', 'STARGAZER'),
    ('reader_rating_050', 'STARWARDEN'),
    ('reader_rating_100', 'CONSTELLATION EYE'),
    ('reader_comment_025', 'ECHOCRAFTER'),
    ('reader_comment_050', 'VOICEWEAVER'),
    ('reader_comment_100', 'GRAND RESONANCE'),
    ('reader_seed_025', 'SEEDBLADE'),
    ('reader_seed_050', 'SEEDWARDEN'),
    ('reader_seed_100', 'SEED SOVEREIGN'),
    ('reader_gold_seed_005', 'GILDED HAND'),
    ('reader_silver_seed_010', 'ARGENT HAND'),
    ('reader_bronze_seed_015', 'BRONZE CREST'),
    ('reader_discovery_plus2_005', 'DEEP TRACE'),
    ('reader_discovery_plus2_010', 'VEILCUTTER'),
    ('reader_discovery_plus2_020', 'HORIZON FINDER'),
    ('reader_discovery_plus3_001', 'FATE GLIMPSE'),
    ('reader_discovery_plus3_005', 'FATESEER'),
    ('reader_discovery_plus3_010', 'FATEWARDEN'),
    ('reader_discovery_plus4_001', 'SKYTRACE'),
    ('reader_discovery_plus4_002', 'SKYSEER'),
    ('reader_discovery_plus4_005', 'HEAVENFINDER'),
    ('reader_nova_001', 'NOVA TRACE'),
    ('reader_nova_003', 'NOVA VISION'),
    ('reader_nova_005', 'NOVA SEER'),
    ('reader_new_author_025', 'DAWNKEEPER'),
    ('reader_new_author_050', 'DAWN HERALD'),
    ('reader_new_author_100', 'DAWN CROWN'),
    ('reader_low_rank_025', 'SHADOWWALKER'),
    ('reader_low_rank_050', 'VEILWALKER'),
    ('reader_low_rank_100', 'ABYSS SEEKER'),
    ('reader_new_work_025', 'INK CHASER'),
    ('reader_new_work_050', 'NEW CHRONICLER'),
    ('reader_new_work_100', 'DAWN ARCHIVIST'),
    ('reader_genre_008', 'REALMSEEKER'),
    ('reader_genre_010', 'TEN REALMS'),
    ('reader_long_read_005', 'SAGA SEEKER'),
    ('reader_long_read_010', 'SAGA WARDEN'),
    ('reader_short_read_010', 'TALE HUNTER'),
    ('reader_short_read_025', 'TALEKEEPER'),
    ('reader_completed_read_005', 'ENDSEEKER'),
    ('reader_completed_read_010', 'LAST PAGE'),
    ('reader_active_days_030', 'THIRTY NIGHTS'),
    ('reader_active_days_090', 'NIGHT PILGRIM'),
    ('reader_level_030', 'ZENITH'),
    ('reader_point_100', 'LUMEN VAULT'),
    ('reader_point_500', 'GRAND LUMEN VAULT'),
    ('reader_read_500', 'LOREMASTER'),
    ('reader_read_1000', 'ETERNAL ARCHIVIST'),
    ('reader_new_author_250', 'ORIGIN SOVEREIGN'),
    ('reader_low_rank_250', 'ABYSS WALKER'),
    ('reader_low_rank_500', 'ABYSS WARDEN'),
    ('reader_discovery_plus2_050', 'VEILBREAKER'),
    ('reader_discovery_plus2_100', 'WORLDREVEALER'),
    ('reader_discovery_plus3_025', 'FATEBREAKER'),
    ('reader_discovery_plus3_050', 'DESTINY WARDEN'),
    ('reader_discovery_plus4_010', 'SKYPIERCER'),
    ('reader_discovery_plus4_020', 'HEAVENBREAKER'),
    ('reader_discovery_plus5_001', 'FIFTH ASCENT'),
    ('reader_discovery_plus5_003', 'ASCENT CROWN'),
    ('reader_discovery_plus5_010', 'MYTHIC ASCENT'),
    ('reader_nova_010', 'NOVA ORACLE'),
    ('reader_nova_025', 'NOVA CROWN'),
    ('reader_gold_plus5_001', 'GOLDEN ASCENT'),
    ('reader_silver_plus5_001', 'ARGENT ASCENT'),
    ('reader_bronze_plus5_001', 'BRONZE ASCENT'),
    ('reader_master_scout', 'ARCHELIGHT'),
    ('author_novel_001', 'INKBORN'),
    ('author_episode_001', 'CHAPTERBORN'),
    ('author_reader_001', 'FIRST WITNESS'),
    ('author_favorite_001', 'HEARTSPARK'),
    ('author_comment_001', 'ANSWERED PAGE'),
    ('author_episode_010', 'CHAPTERSMITH'),
    ('author_episode_025', 'SCRIPTKEEPER'),
    ('author_episode_050', 'CHRONICLER'),
    ('author_episode_100', 'SAGA FORGER'),
    ('author_episode_250', 'SERIAL SOVEREIGN'),
    ('author_chars_010k', 'INKSPARK'),
    ('author_chars_050k', 'WORDSMITH'),
    ('author_chars_100k', 'TOMEFORGED'),
    ('author_chars_250k', 'SCRIPTBOUND'),
    ('author_chars_500k', 'GRAND SCRIBE'),
    ('author_completed_001', 'SEALED TALE'),
    ('author_completed_003', 'THREE CROWNS'),
    ('author_completed_005', 'FIVE CROWNS'),
    ('author_novel_002', 'TWIN WORLDS'),
    ('author_novel_005', 'WORLDWEAVER'),
    ('author_novel_010', 'TENFOLD REALMS'),
    ('author_unique_reader_010', 'FIRST CIRCLE'),
    ('author_unique_reader_050', 'GATHERING'),
    ('author_unique_reader_100', 'HUNDRED EYES'),
    ('author_unique_reader_500', 'GRAND AUDIENCE'),
    ('author_favorite_010', 'HEARTCALL'),
    ('author_favorite_050', 'HEARTWEAVER'),
    ('author_favorite_100', 'HEARTBOUND'),
    ('author_comment_010', 'ECHO CHAMBER'),
    ('author_comment_050', 'HALL OF ECHOES'),
    ('author_seed_received_001', 'LIGHTTOUCHED'),
    ('author_seed_received_010', 'SEEDBLESSED'),
    ('author_seed_received_050', 'SEEDCROWNED'),
    ('author_discovered_plus2_001', 'RISING TALE'),
    ('author_discovered_plus3_001', 'BREAKOUT SAGA'),
    ('author_chars_1m', 'INK IMMORTAL'),
    ('author_completed_010', 'LEGENDARIUM'),
    ('author_unique_reader_1000', 'THOUSAND EYES'),
    ('author_favorite_500', 'CROWNED HEART'),
    ('author_discovered_plus2_005', 'CONSTELLATION MAKER')
)
update public.scout_badge_definitions d
   set display_name = m.display_name,
       metadata = coalesce(d.metadata, '{}'::jsonb)
         || jsonb_build_object('title_name_version','master-2026-09-24'),
       updated_at = now()
  from title_map m
 where d.badge_id = m.badge_id;

update public.scout_badge_definitions
   set display_name = 'DAWNBOUND',
       description = 'NOVELIGHT β期から参加した証となる永久限定称号',
       metadata = coalesce(metadata, '{}'::jsonb)
         || jsonb_build_object('title_name_version','master-2026-09-24'),
       updated_at = now()
 where badge_id = 'limited_beta_participant';

alter table public.user_scout_badges
  alter column is_public set default false;

-- The previous public-badge model allowed multiple simultaneous public badges.
-- MASTER now defines exactly one equipped title, so existing rows start unequipped
-- and each user explicitly chooses the title they want to display.
update public.user_scout_badges
   set is_public = false,
       updated_at = now()
 where is_public;

create or replace function public.novelight_set_scout_badge_visibility(
  p_badge_id text,
  p_is_public boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if coalesce(p_is_public, false) then
    if not exists (
      select 1
      from public.user_scout_badges b
      where b.user_id = v_uid
        and b.badge_id = p_badge_id
        and b.status = 'earned'
    ) then
      return false;
    end if;

    update public.user_scout_badges b
       set is_public = false,
           updated_at = now()
     where b.user_id = v_uid
       and b.is_public;

    update public.user_scout_badges b
       set is_public = true,
           updated_at = now()
     where b.user_id = v_uid
       and b.badge_id = p_badge_id
       and b.status = 'earned';

    v_found := found;
  else
    update public.user_scout_badges b
       set is_public = false,
           updated_at = now()
     where b.user_id = v_uid
       and b.badge_id = p_badge_id
       and b.status = 'earned';

    v_found := found;
  end if;

  return v_found;
end
$$;

revoke all on function public.novelight_set_scout_badge_visibility(text, boolean)
  from public, anon;
grant execute on function public.novelight_set_scout_badge_visibility(text, boolean)
  to authenticated;

comment on function public.novelight_set_scout_badge_visibility(text, boolean) is
  'Compatibility RPC: is_public now means the single equipped SCOUT title. Equipping one earned title unequips every other title for that user.';

commit;
