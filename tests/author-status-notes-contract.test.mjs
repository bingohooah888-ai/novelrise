import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260919090000_author_status_notes.sql',
  'utf8'
);
const management = await readFile('author-notes.html', 'utf8');
const authorPage = await readFile('author.html', 'utf8');
const publicUi = await readFile('novelight-author-notes-public.js', 'utf8');
const publicCss = await readFile('novelight-author-notes-public.css', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');
const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');

test('author notes are RPC-only, owner-bound, and public-only', () => {
  assert.match(
    migration,
    /alter table public\.author_notes enable row level security/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.author_notes from public, anon, authenticated, service_role/iu
  );
  assert.match(migration, /v_uid uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /author_user_id = v_uid/iu);
  assert.match(migration, /note\.status = 'published'/iu);
  assert.match(migration, /novel\.user_id = note\.author_user_id/iu);
  assert.match(migration, /novel\.status = 'published'/iu);
  assert.match(
    migration,
    /grant execute on function public\.novelight_public_author_notes\(uuid,integer\) to anon, authenticated/iu
  );
});
test('rolling deployment fails safely without raw-table fallback', () => {
  assert.match(management, /42883|PGRST202/u);
  assert.match(management, /データベース反映待ち/u);
  assert.doesNotMatch(management, /\.from\(['"]author_notes['"]\)/u);
  assert.match(
    publicUi,
    /if \(error \|\| !Array\.isArray\(data\) \|\| data\.length === 0\) return/u
  );
  assert.match(publicUi, /p_limit: 5/u);
  assert.doesNotMatch(publicUi, /\.from\(['"]author_notes['"]\)/u);
});

test('public author notes are mounted safely on the author profile', () => {
  assert.match(authorPage, /novelight-author-notes-public\.css/u);
  assert.match(authorPage, /novelight-author-notes-public\.js/u);
  assert.match(publicUi, /title\.textContent = note\.title/u);
  assert.match(publicUi, /body\.textContent = note\.body/u);
  assert.match(publicCss, /white-space:pre-wrap/u);
  assert.match(publicUi, /linked_novel/u);
});

test('notes stay outside social, discovery, and analytics systems', () => {
  assert.doesNotMatch(
    migration,
    /insert into public\.(light_seeds|favorites|author_follow_events|notifications|novel_exposure)/iu
  );
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:scout_|analytics|author_follow_events)|recalculate_work_rank/iu
  );
  assert.match(
    master,
    /近況ノートには、いいね、コメント、リポスト／共有数、グローバルタイムライン/u
  );
});

test('migration replay includes B #19 behavior and rollback coverage', () => {
  assert.match(replay, /Verify #19 author status notes/u);
  assert.match(replay, /tests\/rls\/author-status-notes\.sql/u);
  assert.match(replay, /20260919090000_author_status_notes_rollback\.sql/u);
});
