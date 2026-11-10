// Internal, formal-only durable replay. Deliberately no scheduler, cron,
// public route or connection creation. All SQL names are fixed and parameters
// are bound. Invoking this adapter is a future owner-approved server action.
import { createFormalEarningDeliveryPipeline } from './formal-earning-delivery.js';

const SQL=Object.freeze({
  enqueue:'select novelight_formal_private.enqueue_earning_draft($1::text,$2::uuid) as result',
  review:'select novelight_formal_private.decide_earning_review_draft($1::uuid,$2::boolean,$3::text) as result',
  claim:'select novelight_formal_private.claim_earning_draft() as result',
  finish:'select novelight_formal_private.finish_earning_draft($1::text,$2::uuid,$3::uuid,$4::text) as result'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=new Set(['valid_read_qualified','novel_episode_comment_reviewed']);

export function createFormalDurableDelivery({
  postgresClient,
  releaseTimestampIso,
  launchConfiguration,
  trustedServerAuthorization
}) {
  if(typeof postgresClient?.query!=='function')throw new TypeError('Trusted PostgreSQL client required');
  const pipeline=createFormalEarningDeliveryPipeline({
    postgresClient,releaseTimestampIso,launchConfiguration,trustedServerAuthorization
  });
  const enabled=()=>launchConfiguration?.formalEarningsEnabled===true &&
    launchConfiguration?.productionCutoverApproved===true &&
    trustedServerAuthorization?.serviceRoleVerified===true &&
    trustedServerAuthorization?.verifiedByTrustedServer===true;
  async function call(sql,values){
    const result=await postgresClient.query(sql,values);
    if(!result?.rows?.[0]||typeof result.rows[0].result!=='object'){
      throw new Error('FORMAL_DELIVERY_DB_INVALID');
    }
    return result.rows[0].result;
  }
  return Object.freeze({
    async enqueue(eventType,eventId){
      if(!enabled())return {status:'formal_connection_disabled'};
      if(!TYPES.has(eventType)||!UUID.test(eventId))return {status:'invalid_event'};
      return call(SQL.enqueue,[eventType,eventId]);
    },
    async resolveReview(commentId,eligible,reviewRule){
      if(!enabled())return {status:'formal_connection_disabled'};
      if(!UUID.test(commentId)||typeof eligible!=='boolean'||
         typeof reviewRule!=='string'||reviewRule.length<1||reviewRule.length>120){
        return {status:'review_missing'};
      }
      return call(SQL.review,[commentId,eligible,reviewRule]);
    },
    // Explicit one-at-a-time invocation only. Claim is persisted before the
    // award call, allowing a later invocation to recover an expired lease.
    async processNext(){
      if(!enabled())return {status:'formal_connection_disabled',mayIssuePoints:false};
      const claim=await call(SQL.claim,[]);
      if(claim.status!=='leased')return {status:claim.status,mayIssuePoints:false};
      if(!TYPES.has(claim.event_type)||!UUID.test(claim.event_id)||
         !UUID.test(claim.lease_token)){
        return {status:'malformed_lease',mayIssuePoints:false};
      }
      let outcome;
      try{
        outcome=await pipeline.deliverVerifiedEvent({
          eventType:claim.event_type,eventId:claim.event_id,
          moderationDecision:typeof claim.moderation_decision==='boolean'
            ?(claim.moderation_decision?'eligible':'ineligible'):undefined,
          moderationRule:claim.moderation_rule,
          trustedModeratorVerified:typeof claim.moderation_decision==='boolean'
        });
      }catch{
        outcome={status:'private_rpc_failed',mayIssuePoints:false};
      }
      // Point issuance occurs only inside the existing transactional writer.
      // Finish records the outcome; a crash between the two is safe because
      // the Point event_key deduplicates replay after lease expiration.
      const final=await call(SQL.finish,[
        claim.event_type,claim.event_id,claim.lease_token,
        typeof outcome?.status==='string'?outcome.status:'unknown'
      ]);
      return Object.freeze({
        status:final.status,
        deliveryStatus:outcome.status,
        mayIssuePoints:outcome?.mayIssuePoints===true
      });
    }
  });
}
