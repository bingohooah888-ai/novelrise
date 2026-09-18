import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260919100000_author_reader_polls.sql',
  'utf8'
);
const manager = await readFile('novel-polls.html', 'utf8');
const publicUi = await readFile('novelight-novel-poll.js', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('B #20 poll storage is private and RPC-only', () => {
  for (const table of [
    'novel_polls',
    'novel_poll_options',
    'novel_poll_votes'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        'iu'
      )
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on table public\\.${table} from public, anon, authenticated, service_role`,
        'iu'
      )
    );
  }
  assert.match(migration, /primary key \(poll_id, voter_user_id\)/iu);
  assert.match(migration, /foreign key \(poll_id, option_id\)/iu);
});
test('B #20 voting is owner-safe, single-choice, and bandwagon-resistant', () => {
  assert.match(migration, /Authors cannot vote on their own novel poll/u);
  assert.match(migration, /DIRECT_INTERACTION_UNAVAILABLE/u);
  assert.match(migration, /public\.user_blocks block/u);
  assert.match(migration, /A vote has already been recorded for this poll/u);
  assert.match(migration, /for update of poll/iu);
  assert.match(migration, /when unique_violation then/u);
  assert.match(
    migration,
    /v_show_results := v_poll\.status = 'closed' or v_viewer_option_id is not null/u
  );
  assert.match(migration, /'vote_count', case\s+when v_show_results/iu);
  assert.match(migration, /'total_votes', v_total_votes/u);
  assert.match(migration, /'can_vote', v_vote_reason = 'eligible'/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_vote_novel_poll\(bigint,bigint\) to authenticated/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_vote_novel_poll\(bigint,bigint\) to anon/iu
  );
});

test('B #20 author creation is bounded and tied to published owned works', () => {
  assert.match(
    migration,
    /novel\.user_id = v_uid\s+and novel\.status = 'published'/iu
  );
  assert.match(migration, /v_option_count not between 2 and 6/iu);
  assert.match(migration, /Question must be 1 to 200 characters/u);
  assert.match(migration, /Each option must be 1 to 80 characters/u);
  assert.match(migration, /Poll options must be unique/u);
  assert.match(
    migration,
    /At most 50 polls are retained per novel during beta/u
  );
  assert.match(migration, /novel_polls_one_active_per_novel_idx/u);
  assert.match(
    migration,
    /reader polls require profiles, novels, and user_blocks/u
  );
});
test('B #20 UI fails safely before migration and never reads raw poll tables', () => {
  assert.match(manager, /42883|PGRST202/u);
  assert.match(manager, /データベース反映待ち/u);
  assert.match(publicUi, /42883|PGRST202/u);
  assert.doesNotMatch(manager, /\.from\(['"]novel_poll/u);
  assert.doesNotMatch(publicUi, /\.from\(['"]novel_poll/u);
  assert.match(manager, /novelight_manage_my_novel_polls/u);
  assert.match(manager, /novelight_create_my_novel_poll/u);
  assert.match(manager, /novelight_close_my_novel_poll/u);
  assert.match(publicUi, /novelight_public_novel_poll/u);
  assert.match(publicUi, /novelight_vote_novel_poll/u);
});

test('B #20 public rendering uses text nodes and exposes no voter identity', () => {
  assert.match(publicUi, /heading\.textContent = poll\.question/u);
  assert.match(publicUi, /label\.textContent = option\.label/u);
  assert.doesNotMatch(publicUi, /innerHTML\s*=\s*poll\./u);
  assert.doesNotMatch(publicUi, /voter_user_id/u);
  assert.doesNotMatch(manager, /voter_user_id/u);
  assert.match(
    publicUi,
    /投票数は作品Rank・LIGHT SEED・SCOUT・露出には影響しません/u
  );
});

test('B #20 is mounted only on the unlocked novel detail and has owner management', () => {
  assert.match(novelPage, /id="novelPollArea"/u);
  assert.match(novelPage, /novelight-novel-poll\.js/u);
  assert.match(novelPage, /NovelightNovelPoll\.mount\(client,novel,session\)/u);
  assert.match(novelPage, /id="managePolls"/u);
  assert.match(novelPage, /novel-polls\.html\?novel_id=/u);
});
test('B #20 stays outside evaluation and discovery systems', () => {
  assert.doesNotMatch(
    migration,
    /insert into public\.(light_seeds|favorites|novel_exposure_events|author_follow_events|notifications)/iu
  );
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:scout_|analytics)|recalculate_work_rank/iu
  );
  assert.match(
    migration,
    /Poll activity never changes Rank, LIGHT SEED, SCOUT, PV, favorites, search, discovery, exposure, analytics, or recommendations/u
  );
});

test('B #20 migration replay covers behavior and safe rollback', () => {
  assert.match(replay, /Verify B #20 author reader polls/u);
  assert.match(replay, /tests\/rls\/author-reader-polls\.sql/u);
  assert.match(replay, /20260919100000_author_reader_polls_rollback\.sql/u);
});
