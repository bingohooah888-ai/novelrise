import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
const sql = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql',
    import.meta.url
  ),
  'utf8'
);

test('durable formal event table is isolated from beta and existing Scout Point ledger', () => {
  assert.match(
    sql,
    /create table novelight_formal_private\.scout_earning_delivery/
  );
  assert.match(sql, /primary key\(event_type,event_id\)/);
  assert.match(
    sql,
    /state in \('pending','review_pending','retry','leased','completed','held'\)/
  );
  assert.match(
    sql,
    /revoke all on novelight_formal_private\.scout_earning_delivery/
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.enqueue_earning_draft/
  );
});
test('future-only canonical INSERT triggers enroll held reader XP and chapter comments', () => {
  assert.match(
    sql,
    /v_award:=novelight_formal_private\.award_read_points_draft/
  );
  assert.match(
    sql,
    /v_award->>'status' not in \('recorded','already_recorded'\)/
  );
  assert.match(sql, /create trigger scout_formal_comment_enqueue/);
  assert.match(sql, /after insert on public\.novel_comments/);
  assert.match(
    sql,
    /perform novelight_formal_private\.enqueue_earning_draft\(/
  );
});
test('trusted review gate stores eligibility before it becomes due for delivery', () => {
  assert.match(
    sql,
    /create or replace function novelight_formal_private\.decide_earning_review_draft/
  );
  assert.match(sql, /state='review_pending'/);
  assert.match(sql, /moderation_decision is null/);
  assert.match(
    sql,
    /set moderation_decision=p_eligible,moderation_rule=p_rule/
  );
});
test('claim lease uses existing PostgreSQL row locks and expires for restart recovery', () => {
  assert.match(
    sql,
    /create or replace function novelight_formal_private\.claim_earning_draft/
  );
  assert.match(sql, /for update skip locked limit 1/);
  assert.match(sql, /leased_until<now\(\)/);
  assert.match(sql, /lease_token=v_token/);
  assert.match(sql, /leased_until=now\(\)\+interval '5 minutes'/);
});
test('finish needs matching lease token, records terminal/retry outcomes without issuing Points', () => {
  assert.match(
    sql,
    /create or replace function novelight_formal_private\.finish_earning_draft/
  );
  assert.match(sql, /lease_token=p_token and state='leased'/);
  assert.match(
    sql,
    /next_attempt_at=case when v_retry then now\(\)\+interval '5 minutes'/
  );
  assert.match(sql, /return jsonb_build_object\('status','lease_mismatch'\)/);
});
test('no cron, published endpoint, production migration or live beta change', () => {
  assert.match(sql, /FORMAL-RELEASE DRAFT ONLY\. NOT A MIGRATION/);
  assert.doesNotMatch(sql, /create\s+extension/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\./i);
});
