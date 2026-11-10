import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planFormalEarningServerConnection,
  simulateFormalEarningServerConnection,
  executeApprovedFormalEarningConnection
} from '../api/_lib/reader-reward/formal-earning-server-connection.js';

const event = '00000000-0000-4000-8000-000000000017';
const release = '2027-01-01T00:00:00Z';
function plan(overrides = {}) {
  return planFormalEarningServerConnection({
    eventType: 'valid_read_qualified',
    verifiedEventId: event,
    releaseTimestampIso: release,
    sourceCommitted: true,
    serverPrincipalVerified: true,
    authoritativeEvidenceVerified: true,
    ...overrides
  });
}
test('server adapter routes valid read event to existing private transactional read-award SQL', () => {
  const p = plan();
  assert.equal(p.status, 'private_rpc_wiring_plan_only');
  assert.equal(p.schema, 'novelight_formal_private');
  assert.equal(p.functionName, 'award_read_points_draft');
  assert.deepEqual(p.params, { p_read_event_id: event, p_release_at: release });
  assert.equal(p.requiresReadTimeTrigger, 'scout_formal_read_level_capture');
  assert.equal(p.mayIssuePoints, false);
});
test('server adapter routes only approved moderated episode comment to DB writer', () => {
  const p = plan({
    eventType: 'novel_episode_comment_reviewed',
    commentModerationApproved: true
  });
  assert.equal(p.functionName, 'award_comment_points_draft');
  assert.deepEqual(p.params, { p_comment_id: event, p_release_at: release });
  assert.equal(p.requiresReadTimeTrigger, null);
  assert.equal(p.mayIssuePoints, false);
});
test('unapproved comments, unauthenticated source, unsupported event remain blocked', () => {
  assert.equal(
    plan({ eventType: 'novel_episode_comment_reviewed' }).status,
    'comment_moderation_pending'
  );
  assert.equal(
    plan({ sourceCommitted: false }).status,
    'server_evidence_pending'
  );
  assert.equal(
    plan({ authoritativeEvidenceVerified: false }).status,
    'server_evidence_pending'
  );
  assert.equal(
    plan({ serverPrincipalVerified: false }).status,
    'server_evidence_pending'
  );
  assert.equal(
    plan({ eventType: 'point_exchange' }).status,
    'unsupported_formal_event'
  );
  assert.throws(
    () => plan({ verifiedEventId: 'arbitrary browser ID' }),
    TypeError
  );
  assert.throws(() => plan({ releaseTimestampIso: 'invalid' }), TypeError);
});
test('only a positively labeled test mock can simulate a private RPC; never executes a provided client', async () => {
  const p = plan();
  let calls = 0;
  const forged = () => {
    calls++;
  };
  assert.equal(
    (
      await simulateFormalEarningServerConnection({
        plan: p,
        mockPrivateRpc: forged
      })
    ).status,
    'mock_required'
  );
  assert.equal(calls, 0);
  const mock = async (schema, name, params) => {
    calls++;
    assert.equal(schema, 'novelight_formal_private');
    assert.equal(name, 'award_read_points_draft');
    assert.equal(params.p_read_event_id, event);
    return { status: 'recorded' };
  };
  mock.isMock = true;
  const result = await simulateFormalEarningServerConnection({
    plan: p,
    mockPrivateRpc: mock
  });
  assert.equal(result.status, 'mock_rpc_response_only');
  assert.equal(result.resultStatus, 'recorded');
  assert.equal(result.mayIssuePoints, false);
  assert.equal(calls, 1);
});

test('trusted server executor is disabled by default; production cutover and service auth required',async()=>{
 let calls=0;
 const db={callPrivateFunction:async()=>{calls++;return {data:{status:'recorded'},error:null}}};
 const p=plan();
 const base={
   plan:p,db,
   launchConfiguration:{formalEarningsEnabled:true,productionCutoverApproved:true},
   trustedServerAuthorization:{serviceRoleVerified:true,verifiedByTrustedServer:true}
 };
 for(const override of [
   {launchConfiguration:{formalEarningsEnabled:false,productionCutoverApproved:true}},
   {launchConfiguration:{formalEarningsEnabled:true,productionCutoverApproved:false}},
   {trustedServerAuthorization:{serviceRoleVerified:false,verifiedByTrustedServer:true}},
   {trustedServerAuthorization:{serviceRoleVerified:true,verifiedByTrustedServer:false}},
   {db:null},
   {plan:{...p,schema:'public'}},
   {plan:{...p,functionName:'arbitrary'}}
 ]) {
   const result=await executeApprovedFormalEarningConnection({...base,...override});
   assert.notEqual(result.status,'private_rpc_completed');
   assert.equal(result.mayIssuePoints,false);
 }
 assert.equal(calls,0);
});
test('trusted internal executor invokes only approved private RPC with committed source',async()=>{
 let called=0;
 const p=plan();
 const out=await executeApprovedFormalEarningConnection({
   plan:p,
   db:{callPrivateFunction:async({schema,functionName,params})=>{
     called++;
     assert.equal(functionName,'award_read_points_draft');
     assert.deepEqual(params,p.params);
     assert.equal(schema,'novelight_formal_private');
     return {data:{status:'recorded'},error:null};
   }},
   launchConfiguration:{formalEarningsEnabled:true,productionCutoverApproved:true},
   trustedServerAuthorization:{serviceRoleVerified:true,verifiedByTrustedServer:true}
 });
 assert.equal(called,1);
 assert.equal(out.status,'private_rpc_completed');
 assert.equal(out.databaseStatus,'recorded');
 assert.equal(out.mayIssuePoints,true);
});
test('trusted internal executor returns a non-issuance result when private RPC errors',async()=>{
 const p=plan({eventType:'novel_episode_comment_reviewed',commentModerationApproved:true});
 const result=await executeApprovedFormalEarningConnection({
   plan:p,db:{callPrivateFunction:async()=>({data:null,error:{message:'mock failure'}})},
   launchConfiguration:{formalEarningsEnabled:true,productionCutoverApproved:true},
   trustedServerAuthorization:{serviceRoleVerified:true,verifiedByTrustedServer:true}
 });
 assert.equal(result.status,'private_rpc_failed');
 assert.equal(result.mayIssuePoints,false);
});
