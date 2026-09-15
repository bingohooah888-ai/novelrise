import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const migration = read(
  'supabase/migrations/20260916001000_beta_episode_drafts_and_import.sql'
);
const importer = read('episode-import.html');
const drafts = read('episode-drafts.html');
const myNovels = read('my-novels.html');

test('draft and import RPCs stay authenticated-only and RLS remains required', () => {
  assert.match(migration, /RLS must remain enabled on novels and episodes/);
  for (const fn of [
    'novelight_save_episode_draft',
    'novelight_publish_episode_draft_atomic',
    'novelight_import_episode_drafts'
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${fn}`)
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${fn}[\\s\\S]*to authenticated`
      )
    );
  }
  assert.match(migration, /security invoker/g);
});

test('bulk import creates private drafts and validates bounded author-owned input', () => {
  assert.match(
    migration,
    /jsonb_array_length\(p_items\) < 1 or jsonb_array_length\(p_items\) > 200/
  );
  assert.match(migration, /n\.user_id = v_user_id/);
  assert.match(migration, /'draft'/);
  assert.match(migration, /Import contains duplicate episode numbers/);
  assert.match(migration, /already exist in this novel/);
  assert.match(migration, /100000/);
});

test('publishing an imported draft is atomic with first-publication protection', () => {
  assert.match(migration, /for update of e, n/);
  assert.match(migration, /The first published episode must be episode 1/);
  assert.match(
    migration,
    /update public\.novels[\s\S]*set status = 'published'/
  );
  assert.match(
    migration,
    /update public\.episodes[\s\S]*set status = 'published'/
  );
});

test('import page only accepts author-provided text and saves through the bounded RPC', () => {
  assert.match(importer, /TXTファイルから読み込む/);
  assert.match(importer, /=== 話数 \| タイトル ===/);
  assert.match(importer, /novelight_import_episode_drafts/);
  assert.match(importer, /非公開下書き/);
  assert.doesNotMatch(importer, /type="url"/);
  assert.doesNotMatch(importer, /fetch\(['"]https?:/);
});

test('authors can reach draft management and publish imported drafts explicitly', () => {
  assert.match(myNovels, /episode-drafts\.html\?novel_id=/);
  assert.match(myNovels, /下書き・一括移行/);
  assert.match(drafts, /novelight_publish_episode_draft_atomic/);
  assert.match(drafts, /episode-edit\.html\?id=/);
  assert.match(drafts, /一括移行/);
});
