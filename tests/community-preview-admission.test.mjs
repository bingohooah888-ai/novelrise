import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCommunityPreviewAdmission } from '../scripts/community-preview-admission.mjs';

const mainSha='a'.repeat(40), candidateSha='b'.repeat(40);
function fixture() {
  return {
    repository:'bingohooah888-ai/novelrise',
    issue:{number:188,title:'[Staging Approval Control] Preview / Staging cost gate',
      user:{login:'bingohooah888-ai'}},
    comment:{id:123,user:{login:'bingohooah888-ai'},author_association:'OWNER',
      body:'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_APPROVE '+
        JSON.stringify({scope:'community-phase1-preview',mainSha,candidateSha,confirmation:'STAGING APPROVED'})},
    main:{object:{sha:mainSha}},
    pr:{number:2222,state:'open',draft:true,merged:false,
      base:{ref:'main',sha:mainSha},head:{sha:candidateSha,repo:{full_name:'bingohooah888-ai/novelrise'}}},
    compare:{status:'ahead',behind_by:0,ahead_by:1,total_commits:1,
      base_commit:{sha:mainSha},commits:[{sha:candidateSha}]},
    ledgerPages:[[{body:'regular issue discussion'}]]
  };
}
test('exact authorized Draft candidate is a contract match only',()=>{
  assert.deepEqual(assertCommunityPreviewAdmission(fixture()),
    {mainSha,candidateSha,requestCommentId:'123'});
});
for(const [name,mutate] of [
 ['wrong control', x=>x.issue.number=294],
 ['not OWNER', x=>x.comment.author_association='CONTRIBUTOR'],
 ['stale main', x=>x.main.object.sha='f'.repeat(40)],
 ['changed HEAD', x=>x.pr.head.sha='f'.repeat(40)],
 ['forked candidate', x=>x.pr.head.repo.full_name='other/repo'],
 ['merged candidate', x=>x.pr.merged=true],
 ['diverged', x=>x.compare.status='diverged'],
 ['truncated compare', x=>x.compare.total_commits=2],
 ['empty ledger', x=>x.ledgerPages=[]],
 ['incomplete ledger', x=>x.ledgerPages=[Array.from({length:100},()=>({body:'test'}))]],
 ['extra approval key', x=>x.comment.body=x.comment.body.replace('STAGING APPROVED"', 'STAGING APPROVED","bypass":true')],
 ['claimed marker', x=>x.ledgerPages=[[{body:'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CLAIMED '+JSON.stringify(
   {requestCommentId:'123',mainSha,candidateSha,runId:'1'})}]]],
 ['consumed marker', x=>x.ledgerPages=[[{body:'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED '+JSON.stringify(
   {requestCommentId:'123',mainSha,candidateSha,runId:'1',result:'success'})}]]]
])test('fail-closed: '+name,()=>{
 const v=fixture(); mutate(v);
 assert.throws(()=>assertCommunityPreviewAdmission(v),/COMMUNITY_PREVIEW_DENIED/);
});
