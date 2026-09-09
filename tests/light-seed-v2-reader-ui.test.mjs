import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const episode = await readFile('episode.html', 'utf8');
const novel = await readFile('novel.html', 'utf8');

test('episode sends valid-read v2 telemetry', () => {
  assert.match(episode, /record_valid_read_progress/);
  assert.match(episode, /p_episode_id/);
  assert.match(episode, /p_session_id/);
  assert.match(episode, /p_progress_ratio/);
  assert.match(episode, /p_interaction_count/);
  assert.match(episode, /p_client_seq/);
  assert.match(episode, /visibilityState/);
  assert.match(episode, /visibilitychange/);
  assert.match(episode, /pagehide/);
  assert.match(episode, /12000/);
});

test('valid-read telemetry excludes invalid reader states', () => {
  assert.match(episode, /validReadTrackingStarted/);
  assert.match(episode, /isAuthor/);
  assert.match(episode, /!session/);
  assert.match(episode, /!unlocked/);
  assert.match(episode, /stopped/);
  assert.match(episode, /inFlight/);
});

test('novel detail uses only typed LIGHT SEED v2 RPCs', () => {
  assert.match(novel, /light_seed_status_v2/);
  assert.match(novel, /plant_light_seed_v2/);
  assert.doesNotMatch(novel, /rpc\('light_seed_status',/);
  assert.doesNotMatch(novel, /rpc\('plant_light_seed',/);
});

test('novel detail exposes all three LIGHT SEED choices', () => {
  assert.match(novel, /data-seed-type="GOLD"/);
  assert.match(novel, /data-seed-type="SILVER"/);
  assert.match(novel, /data-seed-type="BRONZE"/);
  assert.match(novel, /送信後の取消・種類変更はできません/);
  assert.match(novel, /valid_read_required/);
  assert.match(novel, /この作品のLIGHT SEED/);
});

test('LIGHT SEED v2 UI fails closed without the new RPC', () => {
  assert.match(novel, /LIGHT SEED新仕様の準備中です/);
  assert.match(novel, /現在は送信できません/);
  assert.match(novel, /setSeedButtonsDisabled\(true\)/);
});

test('beta reader UI hides SCOUT progression', () => {
  for (const page of [episode, novel]) {
    assert.doesNotMatch(page, /SCOUT EXP/);
    assert.doesNotMatch(page, /SCOUT XP/);
    assert.doesNotMatch(page, /SCOUT Level/);
  }
});
