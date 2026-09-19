import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260919122554_author_story_planning_notes.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260919122554_author_story_planning_notes_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260919122554_author_story_planning_notes_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260919122554_author_story_planning_notes_rollback.sql',
  'utf8'
);
const page = await readFile('story-notes.html', 'utf8');
const myNovels = await readFile('my-novels.html', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');

test('B23 keeps private planning notes behind owner-bound RPCs', () => {
  assert.ok(
    migration.includes('create table public.novel_private_story_notes')
  );
  assert.ok(
    migration.includes(
      'alter table public.novel_private_story_notes enable row level security'
    )
  );
  assert.ok(
    migration.includes('revoke all on table public.novel_private_story_notes')
  );
  assert.ok(
    migration.includes('from public, anon, authenticated, service_role;')
  );
  assert.ok(
    migration.includes(
      'grant execute on function public.novelight_private_story_notes(bigint)'
    )
  );
  assert.ok(migration.includes('to authenticated;'));
  assert.ok(!migration.includes('to anon'));
  assert.ok(migration.includes('pg_catalog.pg_advisory_xact_lock('));
});

test('B23 reuses the canonical character registry without duplicating identities', () => {
  assert.ok(
    migration.includes(
      'character_id bigint references public.novel_characters(id) on delete set null'
    )
  );
  assert.ok(migration.includes('from public.novel_characters c'));
  assert.ok(migration.includes('c.id = v_character_id'));
  assert.ok(migration.includes('c.novel_id = p_novel_id'));
  assert.ok(!migration.includes('create table public.story_characters'));
});

test('B23 keeps collaborator and reader access outside the private-note contract', () => {
  assert.ok(migration.includes('n.id = p_novel_id'));
  assert.ok(migration.includes('n.user_id = v_uid'));
  assert.ok(migration.includes('Collaborators and readers receive no access'));
  assert.ok(page.includes('読者・共同執筆者・公開プロフィールには表示されず'));
});

test('B23 UI uses RPCs and fails closed instead of reading the raw note table', () => {
  assert.ok(page.includes("client.rpc('novelight_private_story_notes'"));
  assert.ok(page.includes("client.rpc('novelight_save_private_story_note'"));
  assert.ok(page.includes("client.rpc('novelight_delete_private_story_note'"));
  assert.ok(!page.includes(".from('novel_private_story_notes')"));
  assert.ok(page.includes('創作ノートはデータベース反映待ちです'));
  assert.ok(page.includes('name="robots" content="noindex,nofollow"'));
  assert.ok(page.includes('name="referrer" content="no-referrer"'));
});

test('B23 preserves private character notes when a character registry entry is deleted', () => {
  assert.ok(migration.includes('on delete set null'));
  assert.ok(page.includes('人物：登録解除済み（メモは保持中）'));
});

test('B23 rollback refuses to destroy author planning data', () => {
  assert.ok(
    rollback.includes('ROLLBACK REFUSED: B #23 contains private author notes')
  );
  assert.ok(precheck.includes('PRECHECK PASS: B #23'));
  assert.ok(postcheck.includes('POSTCHECK PASS: B #23'));
});

test('B23 owner surfaces link to the private story workspace and MASTER records the boundary', () => {
  assert.ok(myNovels.includes('story-notes.html?novel_id='));
  assert.ok(novel.includes('id="manageStoryNotes"'));
  assert.ok(master.includes('作者用プロット・キャラクター・世界観ノート'));
  assert.ok(master.includes('共同執筆者には開放しない'));
  assert.ok(
    master.includes(
      'Production migrationの適用は、PR mergeとは別の明示承認境界'
    )
  );
});
