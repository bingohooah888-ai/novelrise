import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const sql = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_POINT_MANAGEMENT_PHASE05_DRAFT.sql',
    import.meta.url
  ),
  'utf8'
);

function definition(name) {
  const marker = 'create or replace function novelight_formal_private.' + name;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, name + ' function required');
  const next = sql.indexOf('\ncreate or replace function ', start + marker.length);
  return sql.slice(start, next < 0 ? sql.length : next);
}

test('phase ⑤ reuses exactly the existing private wallet and credit-claim definitions', () => {
  assert.match(sql, /NOT A MIGRATION; DO NOT APPLY/);
  const tables = [
    ...sql.matchAll(/create table if not exists novelight_formal_private\.(\w+)/g)
  ].map((match) => match[1]);
  assert.deepEqual(tables, [
    'scout_point_usage_wallets',
    'scout_point_usage_credit_claims'
  ]);
  assert.match(sql, /references public\.scout_point_ledger\(id\)/);
  assert.match(sql, /canonical_point_id uuid primary key/);
  assert.match(sql, /exchange_eligible_points <= available_points/);
  assert.match(sql, /reserved_points bigint not null default 0/);
  assert.match(sql, /held_points bigint not null default 0/);
});

test('only eligible post-release confirmed Point is mirrored, never beta Point', () => {
  const body = definition('credit_confirmed_formal_point_draft(');
  assert.match(body, /p_formal_release_at > clock_timestamp\(\)/);
  assert.match(body, /where id=p_canonical_point_id and status='confirmed' for update/);
  assert.match(body, /v_point\.point_value <= 0/);
  assert.match(body, /v_point\.occurred_at < p_formal_release_at/);
  assert.match(body, /'formal_read_reward','formal_comment_reward'/);
  assert.match(body, /v_point\.point_kind='level_up'/);
  assert.match(body, /'formal-scout-level-100-owner-20261110'/);
  assert.doesNotMatch(body, /'discovery'|'nova_prediction'/);
  assert.match(body, /Formal wallet cutover not initialized/);
});

test('canonical issue and private wallet credit are one atomic PostgreSQL operation', () => {
  const credit = definition('credit_confirmed_formal_point_draft(');
  const read = definition('award_read_points_draft(');
  const comment = definition('award_comment_points_draft(');
  assert.match(credit, /scout_point_usage_wallets[\s\S]*for update/);
  assert.match(credit, /on conflict\(canonical_point_id\) do nothing/);
  assert.match(credit, /return jsonb_build_object\('status','already_credited'\)/);
  assert.match(credit, /available_points=available_points\+v_point\.point_value/);
  assert.match(credit, /exchange_eligible_points=exchange_eligible_points\+v_point\.point_value/);
  assert.match(credit, /revision=revision\+1/);
  assert.match(credit, /raise exception 'Formal wallet credit not persisted'/);
  for (const writer of [read, comment]) {
    assert.match(writer, /insert into public\.scout_point_ledger/);
    assert.match(writer, /on conflict\(event_key\) do nothing/);
    assert.match(
      writer,
      /perform novelight_formal_private\.credit_confirmed_formal_point_draft\(v_inserted,p_release_at\)/
    );
  }
  assert.doesNotMatch(sql, /^\s*(?:begin|commit|rollback);/gim);
});

test('read issuance needs first verified read and server-captured read-time level', () => {
  const read = definition('award_read_points_draft(');
  assert.match(read, /from public\.valid_read_events where id=p_read_event_id/);
  assert.match(read, /v_read\.reader_id=v_read\.author_id_snapshot/);
  assert.match(read, /scout_read_level_evidence/);
  assert.match(read, /read_time_level_unverified/);
  assert.match(read, /'formal_read_reward:'/);
  assert.match(read, /when v_ev\.scout_level<20 then 1/);
  assert.match(read, /when v_ev\.scout_level<100 then 10 else 11 end/);
});

test('comment credit is limited to reviewed episode comments and 50 per JST month', () => {
  const comment = definition('award_comment_points_draft(');
  assert.match(comment, /public\.novel_comments/);
  assert.match(comment, /public\.valid_read_events/);
  assert.match(comment, /scout_comment_eligibility/);
  assert.match(comment, /scout_comment_review_evidence/);
  assert.match(comment, /review_source_changed_requires_owner_policy/);
  assert.match(comment, /date_trunc\('month',v_comment\.created_at at time zone 'Asia\/Tokyo'\)/);
  assert.match(comment, /v_count\s*>=\s*50/);
  assert.match(comment, /'formal_comment_reward:'/);
  assert.match(comment, /'already_recorded_for_episode'/);
});

test('this draft never enables public earning, migration, Wallet, or redemption', () => {
  assert.doesNotMatch(sql, /\ncreate trigger /i);
  assert.doesNotMatch(sql, /\ngrant /i);
  assert.doesNotMatch(sql, /\ncreate or replace function public\./i);
  assert.match(sql, /from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(sql, /\ninsert into novelight_formal_private\.scout_point_usage_wallets/i);
  assert.doesNotMatch(sql, /\ncreate table.*scout_point_usage_operations/i);
  assert.doesNotMatch(sql, /\ncreate table.*scout_point_usage_budgets/i);
});
