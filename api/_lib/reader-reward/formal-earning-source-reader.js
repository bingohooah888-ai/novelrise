// Formal-only trusted source reader. This module does not enable an API route,
// register a worker, issue Points or modify the existing beta database.
// Source rows must be read from the same server-owned database as the private
// reward functions, never accepted as browser supplied claims.
const QUERIES=Object.freeze({
  read:"select id,reader_id,episode_id_snapshot,qualified_at from public.valid_read_events where id=$1::uuid",
  comment:"select id,user_id,episode_id,body,deleted_at,author_hidden_at,created_at from public.novel_comments where id=$1::uuid",
  prior:"select id,user_id,episode_id,body from public.novel_comments where user_id=$1::uuid and id<>$2::uuid and created_at<=$3::timestamptz order by created_at desc,id desc limit 201"
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createFormalCanonicalSourceReader({postgresClient}){
  if(typeof postgresClient?.query!=='function')throw new TypeError('Trusted database reader required');
  async function read(sql,params){
    const result=await postgresClient.query(sql,params);
    if(!Array.isArray(result?.rows))throw new Error('FORMAL_SOURCE_UNAVAILABLE');
    return result.rows;
  }
  return Object.freeze({
    async load(eventType,eventId){
      if(typeof eventId!=='string'||!UUID.test(eventId)){
        return Object.freeze({status:'invalid_source_id'});
      }
      if(eventType==='valid_read_qualified'){
        const rows=await read(QUERIES.read,[eventId]);
        if(rows.length!==1||rows[0].id!==eventId){
          return Object.freeze({status:'canonical_source_missing'});
        }
        return Object.freeze({status:'canonical_source_verified',eventType,eventId});
      }
      if(eventType==='novel_episode_comment_reviewed'){
        const rows=await read(QUERIES.comment,[eventId]);
        if(rows.length!==1||rows[0].id!==eventId)return Object.freeze({status:'canonical_source_missing'});
        const comment=rows[0];
        if(!UUID.test(comment.user_id)||!Number.isSafeInteger(comment.episode_id)){
          return Object.freeze({status:'canonical_source_invalid'});
        }
        const prior=await read(QUERIES.prior,[comment.user_id,comment.id,comment.created_at]);
        if(prior.length>200)return Object.freeze({status:'history_limit_requires_review'});
        return Object.freeze({
          status:'canonical_source_verified',eventType,eventId,
          verifiedComment:comment,verifiedPriorUserComments:prior
        });
      }
      return Object.freeze({status:'unsupported_source_event'});
    }
  });
}
