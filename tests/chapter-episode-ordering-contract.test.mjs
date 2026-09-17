import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918070000_chapter_episode_ordering.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918070000_chapter_episode_ordering_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918070000_chapter_episode_ordering_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918070000_chapter_episode_ordering_rollback.sql',
  'utf8'
);
const structurePage = await readFile('episode-structure.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const episodePost = await readFile('episode-post.html', 'utf8');
const episodeEdit = await readFile('episode-edit.html', 'utf8');

test('chapter storage is owner-private and chapter membership cannot cross novels', () => {
  assert.match(migration, /create table public\.novel_chapters/i);
  assert.match(
    migration,
    /alter table public\.novel_chapters enable row level security/i
  );
  assert.match(
    migration,
    /foreign key \(chapter_id, novel_id\)[\s\S]*references public\.novel_chapters\(id, novel_id\)/i
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_chapters from public, anon, authenticated/i
  );
  assert.match(migration, /create policy novel_chapters_select_owner/i);
  assert.doesNotMatch(
    migration,
    /grant select on table public\.novel_chapters to anon/i
  );
});

test('structure reorder is atomic and preserves the legacy unique episode numbering contract', () => {
  const reorderStart = migration.indexOf(
    'create function public.novelight_reorder_novel_structure'
  );
  assert.ok(reorderStart >= 0);
  const reorder = migration.slice(
    reorderStart,
    migration.indexOf('create function public.novelight_novel_outline')
  );

  assert.match(reorder, /security definer/i);
  assert.match(reorder, /set search_path = ''/i);
  assert.match(reorder, /for update/i);
  assert.match(
    reorder,
    /Episode ordering must contain every episode exactly once/i
  );
  assert.match(
    reorder,
    /Chapter ordering must contain every chapter exactly once/i
  );
  assert.match(reorder, /set episode_number = -e\.episode_number/i);
  assert.match(reorder, /with ordinality/i);
  assert.match(
    reorder,
    /set episode_number = desired\.new_number,[\s\S]*chapter_id = desired\.chapter_id/i
  );
  assert.match(reorder, /e\.user_id = v_user_id/i);
  assert.match(reorder, /c\.novel_id = p_novel_id/i);
});

test('chapter metadata remains navigation-only and cannot alter evaluation systems', () => {
  for (const forbidden of [
    'novel_work_ranks',
    'light_seed_events',
    'scout_exp',
    'record_novel_exposure',
    'favorites',
    'set pv ='
  ]) {
    assert.ok(
      !migration.toLowerCase().includes(forbidden.toLowerCase()),
      `chapter migration must not mutate evaluation surface: ${forbidden}`
    );
  }
});

test('public outline exposes published episodes only while owner can inspect drafts', () => {
  const outlineStart = migration.indexOf(
    'create function public.novelight_novel_outline'
  );
  assert.ok(outlineStart >= 0);
  const outline = migration.slice(outlineStart);

  assert.match(
    outline,
    /v_is_owner := v_user_id is not null and v_user_id = v_owner_id/i
  );
  assert.match(
    outline,
    /if not v_is_owner and v_novel_status <> 'published' then[\s\S]*return;/i
  );
  assert.match(outline, /v_is_owner[\s\S]*e\.status = 'published'/i);
  assert.match(
    outline,
    /grant execute on function public\.novelight_novel_outline\(bigint\) to anon, authenticated, service_role/i
  );
});

test('author structure manager supports chapter CRUD, assignment and whole-work reorder', () => {
  assert.ok(structurePage.includes('章・並び順管理'));
  assert.ok(
    structurePage.includes("client.rpc('novelight_create_novel_chapter'")
  );
  assert.ok(
    structurePage.includes("client.rpc('novelight_rename_novel_chapter'")
  );
  assert.ok(
    structurePage.includes("client.rpc('novelight_delete_novel_chapter'")
  );
  assert.ok(
    structurePage.includes("client.rpc('novelight_reorder_novel_structure'")
  );
  assert.ok(structurePage.includes('episodeItems=episodes.map'));
  assert.ok(structurePage.includes('chapterOrder=chapters.map'));
  assert.ok(structurePage.includes('normalizeChapterBlocks'));
});

test('novel page renders chapter headings from the safe outline RPC and links owners to manager', () => {
  assert.ok(novelPage.includes("client.rpc('novelight_novel_outline'"));
  assert.ok(novelPage.includes('chapter-heading'));
  assert.ok(novelPage.includes('id="manageStructure"'));
  assert.ok(novelPage.includes('episode-structure.html?novel_id='));
  assert.ok(!novelPage.includes("client.from('novel_chapters')"));
  assert.ok(novelPage.includes('novelight-series.js'));
  assert.ok(novelPage.includes('NovelightSeries.mountNovelContext'));
});

test('direct episode number editing is retired in favor of atomic structure management', () => {
  assert.match(episodePost, /id="episodeNumber"[^>]*readonly/);
  assert.match(episodeEdit, /id="episodeNumber"[^>]*readonly/);
  assert.ok(
    !episodeEdit.includes(
      'episode_number:value.episodeNumber,title:value.title'
    )
  );
  assert.ok(episodeEdit.includes('title:value.title,content:value.content'));
  assert.ok(episodePost.includes('章・並び順管理'));
  assert.ok(episodeEdit.includes('novelight-episode-history.js'));
});

test('RPC grants are fail-closed and include the trusted service role explicitly', () => {
  assert.match(
    migration,
    /revoke all on function public\.novelight_reorder_novel_structure\(bigint, jsonb, jsonb\) from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_reorder_novel_structure\(bigint, jsonb, jsonb\) to authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_novel_outline\(bigint\) to anon, authenticated, service_role/i
  );
});

test('migration ships explicit precheck, postcheck and guarded rollback artifacts', () => {
  assert.match(precheck, /novel_chapters/i);
  assert.match(postcheck, /novelight_reorder_novel_structure/i);
  assert.match(postcheck, /novelight_novel_outline/i);
  assert.match(rollback, /raise exception/i);
  assert.match(
    rollback,
    /drop function if exists public\.novelight_novel_outline/i
  );
  assert.match(rollback, /drop table public\.novel_chapters/i);
});
