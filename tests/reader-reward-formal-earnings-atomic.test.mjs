import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const sql = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql',
    import.meta.url
  ),
  'utf8'
);
test('formal reward SQL remains dormant, with no live triggers, migrations or client access', () => {
  assert.match(sql, /DRAFT ONLY\. NOT A MIGRATION/);
  assert.match(sql, /not under supabase\/migrations/);
  assert.match(sql, /The proposed read-capture trigger is release-only/);
  assert.match(sql, /create trigger scout_formal_read_level_capture/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\./i);
  assert.match(
    sql,
    /revoke all on function novelight_formal_private\.award_read_points_draft/i
  );
  assert.match(
    sql,
    /revoke all on function novelight_formal_private\.award_comment_points_draft/i
  );
});
test('read-time level is captured from locked formal state with a canonical valid read event', () => {
  assert.match(
    sql,
    /create table novelight_formal_private\.scout_read_level_evidence/i
  );
  assert.match(
    sql,
    /read_event_id uuid primary key references public\.valid_read_events/i
  );
  assert.match(
    sql,
    /select \* into v_read from public\.valid_read_events where id=p_read_event_id/i
  );
  assert.match(
    sql,
    /qualified_at<transaction_timestamp\(\)-interval '30 seconds'/i
  );
  assert.match(sql, /level_revision bigint not null/i);
  assert.match(sql, /scout_level_state[\s\S]*?for update/i);
  assert.match(sql, /on conflict\(read_event_id\) do nothing/i);
});
test('read reward is held without historical level evidence and uses the captured level, not current level', () => {
  assert.match(sql, /read_time_level_unverified/i);
  assert.match(sql, /v_ev\.scout_level<20 then 1/i);
  assert.match(sql, /v_ev\.scout_level<100 then 10 else 11/i);
  assert.match(sql, /scout_level_at_read/i);
  assert.match(sql, /level_revision_at_read/i);
  assert.doesNotMatch(sql, /v_state\.current_level<20/i);
  assert.match(sql, /on conflict\(event_key\) do nothing/i);
});
test('comment eligibility requires exact validated chapter read, not self comments or community posts', () => {
  assert.match(sql, /from public\.novel_comments where id=p_comment_id/i);
  assert.match(sql, /v_comment\.episode_id is null/i);
  assert.match(sql, /from public\.novels n/i);
  assert.match(sql, /v_novel_author=v_comment\.user_id/i);
  assert.match(sql, /from public\.episodes e/i);
  assert.match(sql, /e\.novel_id=v_comment\.novel_id/i);
  assert.match(sql, /from public\.valid_read_events/i);
  assert.match(sql, /episode_id_snapshot=v_comment\.episode_id::text/i);
  assert.match(sql, /qualified_at<=v_comment\.created_at/i);
  assert.match(sql, /v_comment\.author_hidden_at is not null/i);
  assert.match(sql, /v_comment\.deleted_at is not null/i);
  assert.match(sql, /content_review_pending_or_rejected/i);
});
test('one rewarded eligible comment per user per episode with existing unique ledger event key', () => {
  assert.match(
    sql,
    /formal_comment_reward:'\|\|v_comment\.user_id::text\|\|':'\|\|v_comment\.episode_id::text/i
  );
  assert.match(sql, /on conflict\(event_key\) do nothing/i);
  assert.match(
    sql,
    /point_kind,point_value,status,event_key,occurred_at,metadata/i
  );
  assert.match(sql, /'formal_comment_reward',20,'confirmed'/i);
  assert.match(sql, /for update/i);
});
test('JST calendar month, exactly 50 qualified comments maximum, UTC timestamp safe', () => {
  assert.match(
    sql,
    /date_trunc\('month',v_comment\.created_at at time zone 'Asia\/Tokyo'\)/i
  );
  assert.match(sql, /v_month_start at time zone 'Asia\/Tokyo'/i);
  assert.match(sql, /v_month_start\+interval '1 month'/i);
  assert.match(sql, /v_count>=50/i);
  assert.match(sql, /policy_month_jst/i);
  assert.doesNotMatch(sql, /p_period_start/i);
});
test('content/anti-spam requires explicit server-reviewed attestation, not client Boolean', () => {
  assert.match(
    sql,
    /create table novelight_formal_private\.scout_comment_eligibility/i
  );
  assert.match(
    sql,
    /comment_id uuid primary key references public\.novel_comments/i
  );
  assert.match(sql, /select eligible into v_attest/i);
  assert.doesNotMatch(sql, /p_comment_evidence_verified/i);
  assert.doesNotMatch(sql, /p_comment_eligibility_approved/i);
});

test('read evidence uses a same-transaction INSERT trigger rather than brittle xmin comparisons', () => {
  assert.match(sql,/after insert on public\\.valid_read_events/);
  assert.match(sql,/returns trigger/);
  assert.match(sql,/new\\.reader_id/);
  assert.doesNotMatch(sql,/txid_current\\(\\)/);
  assert.doesNotMatch(sql,/read_transaction_not_matched/);
});
test('future and pre-release comments cannot claim formal points or block earlier paid order',()=>{
  assert.match(sql,/future_comment_not_eligible/);
  assert.match(sql,/prior.created_at>=p_release_at/);
});
