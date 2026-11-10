import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const sql=readFileSync(new URL('../docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql',import.meta.url),'utf8');

test('SQL stays dormant: not a migration, no triggers or auto-awards',()=>{
 assert.match(sql,/DRAFT ONLY\. NOT A MIGRATION/);
 assert.match(sql,/not under supabase\/migrations/);
 assert.doesNotMatch(sql,/create\s+trigger/i);
 assert.doesNotMatch(sql,/create\s+table/i);
 assert.doesNotMatch(sql,/create\s+or\s+replace\s+function\s+public\./i);
});
test('read award looks up the existing server-confirmed valid read, not arbitrary page views',()=>{
 assert.match(sql,/from public\.valid_read_events where id=p_read_event_id/i);
 assert.match(sql,/v_read\.reader_id=v_read\.author_id_snapshot/i);
 assert.match(sql,/v_read\.qualified_at < p_release_at/i);
 assert.match(sql,/scout_level_state[\s\S]*for update/i);
 assert.match(sql,/rate_policy_pending/);
 assert.match(sql,/formal_read_reward:/);
 assert.match(sql,/on conflict\(event_key\) do nothing/i);
 for(const n of [1,2,3,4,5,6,7,8,9,10,11])assert.match(sql,new RegExp('then '+n+'\\b|else '+n+' end'));
});
test('comment award requires approved eligibility and time policy and uses existing comments',()=>{
 assert.match(sql,/from public\.novel_comments where id=p_comment_id/i);
 assert.match(sql,/comment_policy_pending/);
 assert.match(sql,/month_policy_invalid/);
 assert.match(sql,/comment_outside_policy_month/);
 assert.match(sql,/v_comment\.deleted_at is not null/i);
 assert.match(sql,/v_comment\.author_hidden_at is not null/i);
 assert.match(sql,/p_comment_evidence_verified is distinct from true/i);
});
test('50 per month cap is checked while holding the same formal per-user state lock',()=>{
 assert.match(sql,/scout_level_state[\s\S]*for update/i);
 assert.match(sql,/where user_id=v_comment\.user_id and point_kind='formal_comment_reward'/i);
 assert.match(sql,/v_count>=50/i);
 assert.match(sql,/point_value,status,event_key,occurred_at,metadata/i);
 assert.match(sql,/,'formal_comment_reward',20,'confirmed'/i);
 assert.match(sql,/on conflict\(event_key\) do nothing/i);
});
test('existing Point ledger unique key is authoritative and no client role can call',()=>{
 assert.match(sql,/revoke all on function novelight_formal_private\.award_read_points_draft/i);
 assert.match(sql,/revoke all on function novelight_formal_private\.award_comment_points_draft/i);
 assert.match(sql,/to service_role/i);
 assert.doesNotMatch(sql,/grant execute[\s\S]*to authenticated/i);
 assert.doesNotMatch(sql,/insert into public\.scout_xp_ledger/i);
 assert.doesNotMatch(sql,/update public\.scout_point_ledger/i);
});
