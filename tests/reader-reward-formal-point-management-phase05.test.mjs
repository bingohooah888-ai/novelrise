import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const file = '../docs/drafts/SCOUT_FORMAL_POINT_MANAGEMENT_PHASE05_DRAFT.sql';
const sql = readFileSync(new URL(file, import.meta.url), 'utf8');

function definition(name) {
  const marker = 'create or replace function novelight_formal_private.' + name;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0);
  const next = sql.indexOf('\ncreate or replace function ', start + 65);
  return sql.slice(start, next < 0 ? sql.length : next);
}

test('reuses the existing private Wallet and one-time credit claim', () => {
  const tables = sql.match(/create table if not exists /g) || [];
  assert.equal(tables.length, 2);
  assert.ok(sql.includes('scout_point_usage_wallets'));
  assert.ok(sql.includes('scout_point_usage_credit_claims'));
  assert.ok(sql.includes('references public.scout_point_ledger(id)'));
  assert.ok(sql.includes('canonical_point_id uuid primary key'));
  assert.ok(sql.includes('exchange_eligible_points <= available_points'));
  assert.ok(sql.includes('held_points bigint not null default 0'));
});

test('credits confirmed formal Point but not legacy beta Point', () => {
  const credit = definition('credit_confirmed_formal_point_draft(');
  assert.ok(credit.includes("status='confirmed' for update"));
  assert.ok(credit.includes('v_point.point_value <= 0'));
  assert.ok(credit.includes('v_point.occurred_at < p_formal_release_at'));
  assert.ok(credit.includes("'formal_read_reward','formal_comment_reward'"));
  assert.ok(credit.includes("v_point.point_kind='level_up'"));
  assert.ok(credit.includes('formal-scout-level-100-owner-20261110'));
  assert.ok(credit.includes('Formal wallet cutover not initialized'));
});

test('canonical award and Wallet credit are atomic and idempotent', () => {
  const credit = definition('credit_confirmed_formal_point_draft(');
  const read = definition('award_read_points_draft(');
  const comment = definition('award_comment_points_draft(');
  assert.ok(credit.includes('for update'));
  assert.ok(credit.includes('on conflict(canonical_point_id) do nothing'));
  assert.ok(credit.includes("status','already_credited"));
  assert.ok(credit.includes('available_points=available_points+'));
  assert.ok(
    credit.includes('exchange_eligible_points=exchange_eligible_points+')
  );
  assert.ok(credit.includes('revision=revision+1'));
  assert.ok(credit.includes('Formal wallet credit not persisted'));
  for (const writer of [read, comment]) {
    assert.ok(writer.includes('insert into public.scout_point_ledger'));
    assert.ok(writer.includes('on conflict(event_key) do nothing'));
    assert.ok(writer.includes('credit_confirmed_formal_point_draft'));
  }
  assert.doesNotMatch(sql, /^\s*(?:begin|commit|rollback);/gim);
});

test('read grant uses canonical event and captured read-time Level', () => {
  const read = definition('award_read_points_draft(');
  assert.ok(read.includes('public.valid_read_events'));
  assert.ok(read.includes('v_read.reader_id=v_read.author_id_snapshot'));
  assert.ok(read.includes('scout_read_level_evidence'));
  assert.ok(read.includes('read_time_level_unverified'));
  assert.ok(read.includes("'formal_read_reward:'"));
  assert.ok(read.includes('when v_ev.scout_level<20 then 1'));
  assert.ok(read.includes('when v_ev.scout_level<100 then 10 else 11 end'));
});

test('reviewed episode comment credit respects the 50/JST-month cap', () => {
  const comment = definition('award_comment_points_draft(');
  assert.ok(comment.includes('public.novel_comments'));
  assert.ok(comment.includes('public.valid_read_events'));
  assert.ok(comment.includes('scout_comment_eligibility'));
  assert.ok(comment.includes('scout_comment_review_evidence'));
  assert.ok(comment.includes('review_source_changed_requires_owner_policy'));
  assert.ok(comment.includes("at time zone 'Asia/Tokyo'"));
  assert.match(comment, /v_count\s*>=\s*50/);
  assert.ok(comment.includes("'formal_comment_reward:'"));
  assert.ok(comment.includes('already_recorded_for_episode'));
});

test('no live migration, trigger, grant, or exchange operation', () => {
  assert.ok(sql.includes('NOT A MIGRATION; DO NOT APPLY'));
  assert.doesNotMatch(sql, /\ncreate trigger /i);
  assert.doesNotMatch(sql, /\ngrant /i);
  assert.doesNotMatch(sql, /\ncreate or replace function public\./i);
  assert.ok(sql.includes('from public, anon, authenticated, service_role;'));
  assert.doesNotMatch(sql, /\ncreate table.*scout_point_usage_operations/i);
  assert.doesNotMatch(sql, /\ncreate table.*scout_point_usage_budgets/i);
});
