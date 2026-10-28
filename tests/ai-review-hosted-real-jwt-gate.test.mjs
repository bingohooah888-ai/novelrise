import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyAIHostedJwtAdmission, APPROVAL_PREFIX } from '../.github/staging-ai-jwt/admission.mjs';
import { assertJwtGate } from '../.github/staging-ai-jwt/runner.mjs';

const M='a'.repeat(40),C='b'.repeat(40),OWNER='bingohooah888-ai';
function sample(){
 const comment={id:123,user:{login:OWNER},author_association:'OWNER',
 body:APPROVAL_PREFIX+JSON.stringify({
 scope:'real-auth-jwt-preview-proof',mainSha:M,candidateSha:C,pr:2601,
 migration:'20261028084410',stagingProjectRef:'wmlzjgvxgoyrovdhbqbg',
 deploymentId:'dpl_6DF1tKxfwYMmqJC7dU2qFAHT6D83',
 previewHost:'novelrise-bzrnrif4v-ranobe1.vercel.app',
 confirmation:'STAGING APPROVED'})};
 return {repository:OWNER+'/novelrise',
 issue:{number:294,state:'open',title:'[Staging Control] Supabase migration sync',user:{login:OWNER}},
 comment,actor:OWNER,triggeringActor:OWNER,main:{object:{sha:M}},
 pr:{number:2601,state:'open',draft:true,merged:false,
 base:{ref:'main',sha:M},head:{ref:'codex/ai020704-staging-candidate-db-20261028',
 sha:C,repo:{full_name:OWNER+'/novelrise'}}},
 compare:{status:'ahead',behind_by:0,base_commit:{sha:M},total_commits:1,commits:[{sha:C}]},
 ledgerPages:[[comment]]};
}
test('dedicated JWT approval is pinned to owner, Staging and immutable Preview',()=>{
 const input=sample();
 assert.equal(verifyAIHostedJwtAdmission(input).fixtureNovel,998891003);
 assert.equal(verifyAIHostedJwtAdmission(input).fixtureOwner,'00000000-0000-4000-8000-000000000943');
 input.comment.body=input.comment.body.replace('dpl_6DF1','dpl_WRONG');
 assert.throws(()=>verifyAIHostedJwtAdmission(input),/DENIED/u);
});
test('reject used one-use JWT approval and foreign project',()=>{
 const input=sample();
 input.ledgerPages[0].push({body:'NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED '+JSON.stringify({
 requestCommentId:'123',mainSha:M,candidateSha:C,runId:'1'})});
 assert.throws(()=>verifyAIHostedJwtAdmission(input),/DENIED/u);
});
test('runner refuses missing Staging secrets or admission',()=>{
 assert.throws(()=>assertJwtGate({}),/DENIED/u);
});
test('official Admin user API only, no auth.users SQL fabrication',()=>{
 const src=readFileSync(new URL('../.github/staging-ai-jwt/runner.mjs',import.meta.url),'utf8');
 assert.match(src,/auth\.admin\.createUser/u);
 assert.match(src,/auth\.admin\.deleteUser/u);
 assert.doesNotMatch(src,/insert\s+into\s+auth\.users/iu);
 assert.doesNotMatch(src,/fiepaguycecrredwrcwx/u);
 assert.match(src,/foreignKeyResidue|fkResidue/u);
});
test('workflow stays dormant without OWNER Issue #294 and one-use record',()=>{
 const src=readFileSync(new URL('../.github/workflows/ai-review-hosted-staging-jwt-proof.yml',import.meta.url),'utf8');
 assert.match(src,/issue_comment:/u);
 assert.match(src,/author_association == 'OWNER'/u);
 assert.match(src,/NOVELIGHT_STAGING_AI_JWT_PROOF_APPROVE/u);
 assert.match(src,/NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED/u);
 assert.match(src,/NOVELIGHT_STAGING_AI_JWT_PROOF_CONSUMED/u);
 assert.match(src,/environment: staging/u);
 assert.doesNotMatch(src,/workflow_dispatch:/u);
});
