import assert from 'node:assert/strict';
import test from 'node:test';
import { createFormalPrivatePostgresAdapter } from '../api/_lib/reader-reward/formal-private-postgres-adapter.js';

const uid='00000000-0000-4000-8000-000000000019';
const stamp='2027-01-01T00:00:00Z';
test('private DB adapter accepts only trusted query client and uses fixed bound SQL',async()=>{
  assert.throws(()=>createFormalPrivatePostgresAdapter({postgresClient:{}}),TypeError);
  let calls=0;
  const db=createFormalPrivatePostgresAdapter({postgresClient:{
    query:async(sql,values)=>{
      calls++;
      assert.equal(sql,'select novelight_formal_private.award_read_points_draft($1::uuid,$2::timestamptz) as result');
      assert.deepEqual(values,[uid,stamp]);
      return {rows:[{result:{status:'recorded',points:11}}]};
    }
  }});
  const result=await db.callPrivateFunction({
    schema:'novelight_formal_private',
    functionName:'award_read_points_draft',
    params:{p_read_event_id:uid,p_release_at:stamp}
  });
  assert.deepEqual(result,{data:{status:'recorded',points:11},error:null});
  assert.equal(calls,1);
});
test('review and award use one parameterized SQL call with verified moderation',async()=>{
  let calls=0;
  const db=createFormalPrivatePostgresAdapter({postgresClient:{
    query:async(sql,values)=>{
      calls++;
      assert.equal(sql,'select novelight_formal_private.review_comment_and_award_draft($1::uuid,$2::timestamptz,$3::boolean,$4::text) as result');
      assert.deepEqual(values,[uid,stamp,true,'moderation-v1']);
      return {rows:[{result:{status:'recorded',points:20}}]};
    }
  }});
  const response=await db.callPrivateFunction({
    schema:'novelight_formal_private',
    functionName:'review_comment_and_award_draft',
    params:{p_comment_id:uid,p_release_at:stamp,p_content_eligible:true,p_reviewer_rule:'moderation-v1'}
  });
  assert.equal(response.data.points,20);
  assert.equal(calls,1);
});
test('malformed events, unknown functions and missing moderation do not run queries',async()=>{
  let calls=0;
  const db=createFormalPrivatePostgresAdapter({postgresClient:{query:async()=>{calls++;return {rows:[]}}}});
  for(const x of [
    {schema:'public',functionName:'award_read_points_draft',params:{p_read_event_id:uid,p_release_at:stamp}},
    {schema:'novelight_formal_private',functionName:'custom_sql',params:{}},
    {schema:'novelight_formal_private',functionName:'award_read_points_draft',params:{p_read_event_id:"' OR 1=1",p_release_at:stamp}},
    {schema:'novelight_formal_private',functionName:'review_comment_and_award_draft',params:{p_comment_id:uid,p_release_at:stamp,p_content_eligible:false,p_reviewer_rule:'x'}}
  ]){
    const out=await db.callPrivateFunction(x);
    assert.ok(out.error);
  }
  assert.equal(calls,0);
});
test('database failure cannot leak connection details to caller',async()=>{
  const db=createFormalPrivatePostgresAdapter({postgresClient:{query:async()=>{throw Error('secret connection password')}}});
  const x=await db.callPrivateFunction({schema:'novelight_formal_private',functionName:'award_read_points_draft',params:{p_read_event_id:uid,p_release_at:stamp}});
  assert.deepEqual(x,{data:null,error:{code:'FORMAL_DB_QUERY_FAILED'}});
});
