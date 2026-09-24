import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const version = '20260920082032';
const migration = await readFile(
  `supabase/migrations/${version}_episode_hearts.sql`,
  'utf8'
);
const precheck = await readFile(
  `supabase/checks/${version}_episode_hearts_precheck.sql`,
  'utf8'
);
const postcheck = await readFile(
  `supabase/checks/${version}_episode_hearts_postcheck.sql`,
  'utf8'
);
const rollback = await readFile(
  `supabase/rollback/${version}_episode_hearts_rollback.sql`,
  'utf8'
);
const episode = await readFile('episode.html', 'utf8');
const runtime = await readFile('novelight-episode-heart.js', 'utf8');
const css = await readFile('novelight-episode-heart.css', 'utf8');
const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');
const restore = await readFile(
  'supabase/checks/restore_validation.sql',
  'utf8'
);

test('episode hearts are private, unique per user and episode, and RPC-only', () => {
  assert.match(migration, /create table public\.episode_hearts/iu);
  assert.match(migration, /primary key \(episode_id, user_id\)/iu);
  assert.match(migration, /episode_hearts_user_id_idx/iu);
  assert.match(
    migration,
    /alter table public\.episode_hearts enable row level security/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.episode_hearts from public, anon, authenticated/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_episode_heart_state\(bigint\)[\s\S]*to anon, authenticated/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_toggle_episode_heart\(bigint\)[\s\S]*to authenticated/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_toggle_episode_heart\(bigint\)[\s\S]*to anon/iu
  );
});

test('episode heart mutation enforces publication, self-heart, block, and concurrency boundaries', () => {
  assert.match(
    migration,
    /e\.status = 'published'[\s\S]*n\.status = 'published'/iu
  );
  assert.match(migration, /EPISODE_HEART_UNAVAILABLE/u);
  assert.match(migration, /EPISODE_HEART_SELF_NOT_ALLOWED/u);
  assert.match(
    migration,
    /b\.blocker_user_id = v_author_id and b\.blocked_user_id = v_uid/iu
  );
  assert.match(
    migration,
    /b\.blocker_user_id = v_uid and b\.blocked_user_id = v_author_id/iu
  );
  assert.match(migration, /DIRECT_INTERACTION_UNAVAILABLE/u);
  assert.match(migration, /pg_advisory_xact_lock/iu);
  assert.match(
    migration,
    /novelight:episode-heart:' \|\| p_episode_id::text \|\| ':' \|\| v_uid::text/iu
  );
  assert.match(
    migration,
    /insert into public\.episode_hearts\(episode_id, user_id\)/iu
  );
  assert.match(
    migration,
    /delete from public\.episode_hearts[\s\S]*episode_id = p_episode_id[\s\S]*user_id = v_uid/iu
  );
});

test('episode hearts stay independent from evaluation and exposure systems', () => {
  const functions =
    migration.match(
      /create or replace function public\.novelight_episode_heart_state[\s\S]*?grant execute on function public\.novelight_toggle_episode_heart\(bigint\)[\s\S]*?to authenticated;/iu
    )?.[0] || '';
  assert.ok(functions);
  assert.doesNotMatch(
    functions,
    /send_light_seed|scout_xp|scout_event|work_rank|recalculate_work_rank|novel_exposure|record_episode_pv|insert into public\.favorites|update public\.novels[\s\S]*\bpv\s*=/iu
  );
  assert.match(
    master,
    /エピソードハート数を、作品Rank、LIGHT SEED、SCOUT RECORD、Scout XP/
  );
  assert.match(master, /ハートを押すだけでScout XPを付与しない/);
});

test('reader UI exposes aggregate hearts, login gating, toggle, and safe rolling deployment fallback', () => {
  assert.match(episode, /novelight-episode-heart\.css/u);
  assert.match(episode, /novelight-episode-heart\.js/u);
  assert.match(episode, /id="episodeHeartMount"/u);
  assert.match(episode, /NovelightEpisodeHeart\.mount/iu);
  assert.match(runtime, /novelight_episode_heart_state/u);
  assert.match(runtime, /novelight_toggle_episode_heart/u);
  assert.match(runtime, /login\.html\?redirect=/u);
  assert.match(runtime, /runtime-missing/u);
  assert.match(runtime, /aria-pressed/u);
  assert.match(runtime, /作者本人は自分のエピソードへハートできません/u);
  assert.match(runtime, /DIRECT_INTERACTION_UNAVAILABLE/u);
  assert.match(css, /\.episode-heart-button\.hearted/);
});

test('MASTER fixes the beta episode-heart semantics implemented here', () => {
  for (const phrase of [
    'エピソードハートは「この話が良かった」',
    '1ユーザーにつき1エピソード1件まで',
    '作者本人は自分のエピソードへハートできない',
    'ハート総数は読者・作者へ公開表示できる',
    '個々のハート送信者を作者へ一覧公開する機能はβ版の必須範囲にしない'
  ]) {
    assert.ok(master.includes(phrase), phrase);
  }
});

test('episode heart migration ships precheck, postcheck, guarded rollback, replay, and restore coverage', () => {
  assert.match(precheck, /Episode hearts prerequisites are missing/u);
  assert.match(postcheck, /episode_hearts RLS is not enabled/u);
  assert.match(postcheck, /Episode heart RPC grants are incorrect/u);
  assert.match(
    postcheck,
    /Episode heart toggle must remain evaluation-neutral/u
  );
  assert.match(
    rollback,
    /Rollback blocked: episode hearts contain user reaction data/u
  );
  assert.match(
    replay,
    /Verify episode hearts behavior[\s\S]*tests\/rls\/episode-hearts\.sql/iu
  );
  assert.match(
    replay,
    /Verify episode hearts rollback and reapply[\s\S]*20260920082032_episode_hearts_rollback\.sql[\s\S]*20260920082032_episode_hearts\.sql/iu
  );
  assert.match(restore, /'episode_hearts'/u);
  assert.match(restore, /'novelight_episode_heart_state'/u);
  assert.match(restore, /'novelight_toggle_episode_heart'/u);
});
