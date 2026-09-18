import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918211545_character_appearance_list.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918211545_character_appearance_list_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918211545_character_appearance_list_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918211545_character_appearance_list_rollback.sql',
  'utf8'
);
const runtime = await readFile('novelight-characters.js', 'utf8');
const manager = await readFile('characters.html', 'utf8');
const reader = await readFile('episode.html', 'utf8');
const editor = await readFile('episode-edit.html', 'utf8');
const work = await readFile('novel.html', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('character registry is canonical, private, and bounded', () => {
  assert.match(migration, /create table public\.novel_characters/iu);
  assert.match(migration, /create table public\.novel_character_episode_states/iu);
  assert.match(migration, /cardinality\(aliases\) <= 12/iu);
  assert.match(migration, /At most 100 characters can be registered per work/iu);
  assert.match(migration, /alter table public\.novel_characters enable row level security/iu);
  assert.match(
    migration,
    /revoke all on table public\.novel_characters[\s\S]*from public, anon, authenticated, service_role/iu
  );
});

test('episode writes use one trigger and manual state overrides automatic detection', () => {
  assert.match(
    migration,
    /after insert or update of content, novel_id on public\.episodes/iu
  );
  assert.match(migration, /_novelight_character_matches_body/iu);
  assert.match(migration, /_novelight_rescan_character/iu);
  assert.match(migration, /override_mode in \('include', 'exclude'\)/iu);
  assert.match(
    migration,
    /s\.override_mode = 'include'[\s\S]*s\.override_mode is null and s\.auto_detected/iu
  );
  assert.doesNotMatch(migration, /create table public\.episode_character_events/iu);
});

test('reader feed is spoiler bounded and omits raw aliases', () => {
  const start = migration.indexOf(
    'create or replace function public.novelight_character_feed'
  );
  assert.ok(start > -1);
  const body = migration.slice(start);
  assert.match(body, /e\.status = 'published'/iu);
  assert.match(body, /n\.status = 'published'/iu);
  assert.match(body, /e\.episode_number <= v_current_number/iu);
  assert.match(body, /c\.reader_visible/iu);
  assert.doesNotMatch(body, /'aliases'/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_character_feed\(bigint\)[\s\S]*to anon, authenticated/iu
  );
});

test('owner mutation RPCs are authenticated-only and internal helpers are not client executable', () => {
  assert.match(
    migration,
    /grant execute on function public\.novelight_upsert_character\([\s\S]*?\)\s+to authenticated/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_upsert_character\([\s\S]*?\)\s+to anon/iu
  );
  assert.match(
    migration,
    /revoke all on function public\._novelight_rescan_character\(bigint\)[\s\S]*service_role/iu
  );
});

test('author and reader UI fail safe when DB runtime is not deployed', () => {
  assert.match(runtime, /PGRST202/u);
  assert.match(runtime, /Could not find the function/u);
  assert.match(runtime, /mountReader/u);
  assert.match(runtime, /mountEpisodeEditor/u);
  assert.match(manager, /データベース反映待ち/u);
  assert.match(reader, /NovelightCharacters\.mountReader/u);
  assert.match(editor, /NovelightCharacters\.mountEpisodeEditor/u);
  assert.match(work, /characters\.html\?novel_id=/u);
});

test('reader wording explicitly states the no-future-information contract', () => {
  assert.match(runtime, /この話より先の登場情報は表示しません/u);
  assert.match(runtime, /appears_current_episode/u);
  assert.match(runtime, /latest_episode_number/u);
});

test('migration ships with precheck, postcheck, guarded rollback, and replay coverage', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: character appearance prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: character appearance is private, owner-controlled, trigger-backed, and spoiler-safe/u
  );
  assert.match(postcheck, /has_table_privilege/iu);
  assert.match(postcheck, /has_function_privilege/iu);
  assert.match(
    rollback,
    /ROLLBACK REFUSED: registered character data exists/u
  );
  assert.match(
    replay,
    /Verify character appearance behavior[\s\S]*character-appearance-list\.sql/iu
  );
});

test('character appearance never changes Rank, SCOUT, PV, favorites, or exposure', () => {
  assert.match(
    migration,
    /Never a Rank, SCOUT, PV, favorite, discovery, or exposure signal/iu
  );
  assert.doesNotMatch(
    migration,
    /recalculate_work_rank|send_light_seed|scout_xp_ledger|novel_exposure_events|favorite_count|\bpv\s*=\s*\bpv\b/iu
  );
});
