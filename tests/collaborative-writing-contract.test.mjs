import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260919112318_novel_collaborative_writing.sql',
  'utf8'
);
const collaboration = await readFile('collaboration.html', 'utf8');
const episodeEdit = await readFile('episode-edit.html', 'utf8');
const myNovels = await readFile('my-novels.html', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const schedule = await readFile('novelight-episode-schedule.js', 'utf8');
const history = await readFile('novelight-episode-history.js', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('B #22 storage stays private and preserves one novel owner', () => {
  for (const table of [
    'novel_collaborators',
    'novel_collaboration_invites',
    'novel_collaboration_events'
  ]) {
    assert.match(
      migration,
      new RegExp(
        'alter table public\\.' + table + ' enable row level security',
        'iu'
      )
    );
    assert.match(
      migration,
      new RegExp(
        'revoke all on table public\\.' +
          table +
          '[^;]*public, anon, authenticated, service_role',
        'isu'
      )
    );
  }
  assert.doesNotMatch(migration, /update\s+public\.novels\s+set\s+user_id/iu);
  assert.match(migration, /novels\.user_id remains the sole owner/iu);
});
test('B #22 invitation and membership are bounded and revocable', () => {
  assert.match(migration, /interval '7 days'/u);
  assert.match(migration, /At most 5 collaborators are available during beta/u);
  assert.match(
    migration,
    /sha256\(pg_catalog\.convert_to\(v_token, 'UTF8'\)\)/u
  );
  assert.match(migration, /delete from public\.novel_collaboration_invites/iu);
  assert.match(migration, /novelight_remove_novel_collaborator/iu);
  assert.match(migration, /novelight_leave_novel_collaboration/iu);
  assert.match(migration, /public\.user_blocks/iu);
});

test('B #22 editor RPC is content-only and cannot publish or delete', () => {
  assert.match(migration, /novelight_update_collaboration_episode/iu);
  assert.match(migration, /set title=v_title,[\s\S]*content=v_content/iu);
  assert.doesNotMatch(
    migration,
    /novelight_update_collaboration_episode[\s\S]*set\s+status\s*=\s*'published'/iu
  );
  assert.doesNotMatch(
    migration,
    /novelight_update_collaboration_episode[\s\S]*delete from public\.episodes/iu
  );
  assert.match(
    migration,
    /title\/content-only editor path[\s\S]*cannot publish, delete, transfer ownership/iu
  );
});

test('B #22 UI keeps invitation URLs out of indexing and referrers', () => {
  assert.match(collaboration, /meta name="robots" content="noindex,nofollow"/u);
  assert.match(collaboration, /meta name="referrer" content="no-referrer"/u);
  assert.match(collaboration, /novelight_accept_collaboration_invite/u);
  assert.match(collaboration, /novelight_rotate_collaboration_invite/u);
  assert.match(collaboration, /novelight_remove_novel_collaborator/u);
  assert.match(collaboration, /novelight_leave_novel_collaboration/u);
  assert.doesNotMatch(collaboration, /\.from\(['"]novel_collabor/iu);
});
test('B #22 collaboration editor reuses episode editor without owner powers', () => {
  assert.match(episodeEdit, /novelight_get_collaboration_episode/u);
  assert.match(episodeEdit, /novelight_update_collaboration_episode/u);
  assert.match(episodeEdit, /collaborationEditor/u);
  assert.match(episodeEdit, /publishDraft\.hidden=true/u);
  assert.match(
    episodeEdit,
    /共同執筆者は話数・章・並び順を変更できません。公開・削除も作品所有者のみ/u
  );
  assert.match(episodeEdit, /owned\.data\?\.user_id===session\.user\.id/u);
  assert.match(schedule, /dataset\.collaborationEditor === 'true'/u);
  assert.match(history, /dataset\.collaborationEditor === 'true'/u);
});

test('B #22 collaboration is reachable from author work surfaces', () => {
  assert.match(myNovels, /collaboration\.html/u);
  assert.match(myNovels, /共同執筆管理/u);
  assert.match(novel, /id="manageCollaboration"/u);
  assert.match(novel, /collaboration\.html\?novel_id=/u);
});

test('B #22 avoids evaluation, discovery, and monetization signals', () => {
  assert.doesNotMatch(
    migration,
    /insert into public\.(?:light_seeds|favorites|novel_exposure_events|author_follow_events|notifications)/iu
  );
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:scout_|analytics)|recalculate_work_rank/iu
  );
  assert.doesNotMatch(migration, /stripe_|payment_status|plan\s*=/iu);
  assert.match(
    collaboration,
    /作品Rank・LIGHT SEED・SCOUT・PV・お気に入り・検索順位・発見棚・露出・LIGHT ANALYTICS・おすすめに影響しません/u
  );
});

test('B #22 migration replay covers behavior and safe rollback', () => {
  assert.match(replay, /Verify B #22 collaborative writing/u);
  assert.match(replay, /tests\/rls\/collaborative-writing\.sql/u);
  assert.match(
    replay,
    /20260919112318_novel_collaborative_writing_rollback\.sql/u
  );
});
