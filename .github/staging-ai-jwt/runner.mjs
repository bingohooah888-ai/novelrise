// DORMANT, trusted-main only. Official Auth Admin API; never INSERT auth.users.
import { randomBytes,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertPrecheck,PRECHECK_SQL } from '../staging-ai-proof/census.mjs';
import { verifyStagingMigrationTarget } from '../../scripts/verify-staging-migration-target.mjs';
import { validateHostedJwtProofConfig,probeRealHostedJwt,verifyHostedPreviewViaVercel } from './probe.mjs';

const ID='00000000-0000-4000-8000-000000000943';
const EMAIL='ai-review-jwt@example.invalid';
const NOVEL=998891003;
const STAGING='https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const STAGE_REF='wmlzjgvxgoyrovdhbqbg';
function fail(){throw new Error('STAGING_REAL_JWT_DENIED');}
// Fixed phase labels only. Never log HTTP bodies, tokens, SQL, or error details.
function traceStage(label){process.stdout.write('REAL_STAGING_JWT_SAFE_PHASE: '+label+'\n');}
function command(name,args){
  return execFileSync(name,args,{encoding:'utf8',timeout:25000,
    maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).trim();
}
export function assertJwtGate(env){
  if(env.NOVELIGHT_STAGING_AI_JWT_ADMITTED!=='1' ||
     env.STAGING_PROJECT_REF!==STAGE_REF||env.STAGING_SUPABASE_URL!==STAGING ||
     env.APPROVED_PREVIEW_DEPLOYMENT_ID!=='dpl_2uDtKuUT5RpB97pxtMhYPQpmkCHx' ||
     env.APPROVED_PREVIEW_HOST!=='novelrise-7mmz9wjjo-ranobe1.vercel.app' ||
     !/^[a-f0-9]{40}$/.test(env.APPROVED_MAIN_SHA||'') ||
     !/^[a-f0-9]{40}$/.test(env.APPROVED_CANDIDATE_SHA||'') ||
     !/^[1-9][0-9]*$/.test(env.STAGING_APPROVAL_COMMENT_ID||'') ||
     !['STAGING_DATABASE_URL_FILE','STAGING_SUPABASE_SECRET_KEY',
       'STAGING_SUPABASE_PUBLISHABLE_KEY','VERCEL_READONLY_API_TOKEN',
       'VERCEL_AUTOMATION_BYPASS_SECRET'].every(k=>!!env[k])) fail();
  return true;
}
function sql(db,query){
  return command('psql',[db,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',query]);
}
function audit(db,phase,createdId=ID){
  // Existing audited trigger+function fingerprints; migration once, AI OFF/budget 0.
  assertPrecheck(JSON.parse(sql(db,PRECHECK_SQL)),STAGE_REF);
  const q="select json_build_object("+
    "'user',(select count(*) from auth.users where id='"+ID+"'::uuid or lower(email)='"+EMAIL+"'),"+
    "'identities',(select count(*) from auth.identities where user_id='"+ID+"'::uuid),"+
    "'sessions',(select count(*) from auth.sessions where user_id='"+ID+"'::uuid),"+
    "'profile',(select count(*) from public.profiles where id='"+ID+"'::uuid),"+
    "'novel',(select count(*) from public.novels where id="+NOVEL+"),"+
    "'typo',(select count(*) from public.novel_typo_report_settings where novel_id="+NOVEL+"),"+
    "'other',(select count(*) from auth.users where id='"+createdId+"'::uuid)"+
    "+(select count(*) from public.profiles where id='"+createdId+"'::uuid),"+
    "'sideEffects',(select count(*) from public.founding_authors where author_id='"+ID+"'::uuid)"+
    "+(select count(*) from public.beta_participants where auth_user_id='"+ID+"'::uuid or email_normalized='"+EMAIL+"')"+
    "+(select count(*) from public.scout_reward_campaign_entries where user_id='"+ID+"'::uuid)"+
    "+(select count(*) from public.author_follow_events where author_user_id='"+ID+"'::uuid or novel_id="+NOVEL+")"+
    "+(select count(*) from public.novel_rank_state where novel_id_snapshot='"+NOVEL+"' or author_id_snapshot='"+ID+"')"+
    "+(select count(*) from public.novel_rank_events where novel_id_snapshot='"+NOVEL+"' or author_id_snapshot='"+ID+"'))";
  const out=JSON.parse(sql(db,q));
  const expect=phase==='fixture'?{user:1,identities:1,sessions:0,profile:1,novel:1,typo:1,sideEffects:0}:
    {user:0,identities:0,sessions:0,profile:0,novel:0,typo:0,sideEffects:0,other:0};
  for(const [k,v] of Object.entries(expect)) if(out[k]!==v) fail();
}
function fkResidue(db){
  const stmt="select format('select count(*) from %I.%I where %I %s;',n.nspname,c.relname,a.attname,"+
    "case when k.confrelid in ('auth.users'::regclass,'public.profiles'::regclass)"+
    " then '= ''"+ID+"''::uuid' else '= "+NOVEL+"' end)"+
    " from pg_constraint k join pg_class c on c.oid=k.conrelid"+
    " join pg_namespace n on n.oid=c.relnamespace"+
    " join lateral unnest(k.conkey) with ordinality ck(attnum,pos) on true"+
    " join lateral unnest(k.confkey) with ordinality fk(attnum,pos) on fk.pos=ck.pos"+
    " join pg_attribute a on a.attrelid=k.conrelid and a.attnum=ck.attnum"+
    " join pg_attribute b on b.attrelid=k.confrelid and b.attnum=fk.attnum"+
    " where k.contype='f' and array_length(k.conkey,1)=1 and b.attname='id'"+
    " and k.confrelid in ('auth.users'::regclass,'public.profiles'::regclass,'public.novels'::regclass);";
  for(const line of sql(db,stmt).split('\n')) if(line.trim()&&sql(db,line.trim())!=='0') fail();
}
async function main(){
  const e=process.env;
  assertJwtGate(e);
  if(command('git',['rev-parse','HEAD'])!==e.APPROVED_MAIN_SHA||
    command('gh',['api','repos/bingohooah888-ai/novelrise/git/ref/heads/main','--jq','.object.sha'])!==e.APPROVED_MAIN_SHA||
    command('gh',['api','repos/bingohooah888-ai/novelrise/pulls/2601','--jq','.head.sha'])!==e.APPROVED_CANDIDATE_SHA) fail();
  const db=readFileSync(e.STAGING_DATABASE_URL_FILE,'utf8').trim();
  verifyStagingMigrationTarget({STAGING_SUPABASE_URL:STAGING,STAGING_DATABASE_URL:db,PGSSLMODE:'require'});
  traceStage('INITIAL_CENSUS');
  audit(db,'initial');
  traceStage('FK_CENSUS');
  fkResidue(db);
  const proofEnv={...e,NOVELIGHT_HOSTED_JWT_ADMITTED:'1',
    STAGING_PROJECT_REF:STAGE_REF,
    NOVELIGHT_HOSTED_TEST_USER_ID:ID,NOVELIGHT_HOSTED_TEST_USER_EMAIL:EMAIL,
    NOVELIGHT_HOSTED_TEST_NOVEL_ID:String(NOVEL),
    APPROVED_PREVIEW_SHA:e.APPROVED_CANDIDATE_SHA,
    NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID:e.APPROVED_PREVIEW_DEPLOYMENT_ID,
    NOVELIGHT_HOSTED_PREVIEW_URL:'https://'+e.APPROVED_PREVIEW_HOST,
    NOVELIGHT_HOSTED_TEST_USER_PASSWORD:'preflight-placeholder-password'};
  const config=validateHostedJwtProofConfig(proofEnv);
  traceStage('VERCEL_ATTEST');
  await verifyHostedPreviewViaVercel(config,proofEnv);
  const bypass={'x-vercel-protection-bypass':e.VERCEL_AUTOMATION_BYPASS_SECRET};
  const fetchChecked=async(path)=>{
    const r=await fetch(config.preview+path,{headers:bypass,redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(r.status!==200) fail();return r.json();
  };
  traceStage('PREVIEW_FACTS');
  const facts=await fetchChecked('/api/staging-environment-facts');
  traceStage('PREVIEW_BROWSER_CONFIG');
  const browser=await fetchChecked('/api/staging-browser-config');
  const fingerprint=createHash('sha256').update(e.STAGING_SUPABASE_PUBLISHABLE_KEY).digest('hex');
  if(facts.vercelEnv!=='preview'||facts.commitSha!==config.revision||
     facts.appBaseUrl!==config.preview||facts.supabase?.url!==STAGING||
     facts.supabase?.serverSecretPresent!==true||facts.stripe?.secretKeyMode!=='test'||
     facts.supabase?.publishableKeyFingerprint!==fingerprint||
     browser.supabaseUrl!==STAGING||browser.supabasePublishableKey!==e.STAGING_SUPABASE_PUBLISHABLE_KEY) fail();
  const admin=createClient(STAGING,e.STAGING_SUPABASE_SECRET_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  // Proves admin key works at the exact staging project, without exposing user data.
  traceStage('AUTH_ADMIN_READ');
  const read=await admin.auth.admin.listUsers({page:1,perPage:1});
  if(read.error||!Array.isArray(read.data?.users)) fail();
  let created=null,error=null;
  try{
    const password=randomBytes(32).toString('hex');
    traceStage('AUTH_CREATE');
    const result=await admin.auth.admin.createUser({
      id:ID,email:EMAIL,password,email_confirm:true,app_metadata:{internal_e2e:true}
    });
    created=result.data?.user||null;
    if(result.error||!created||created.id!==ID||created.email!==EMAIL) fail();
    traceStage('NOVEL_CREATE');
    sql(db,"begin; set local statement_timeout='12s'; set local lock_timeout='3s';"+
      "insert into public.novels(id,user_id,title,status) values ("+NOVEL+",'"+ID+"','Synthetic JWT read test','draft'); commit;");
    traceStage('FIXTURE_CENSUS');
    audit(db,'fixture');
    proofEnv.NOVELIGHT_HOSTED_TEST_USER_PASSWORD=password;
    traceStage('JWT_HTTP');
    await probeRealHostedJwt(config, proofEnv, async (jwt) => {
      const result = await admin.auth.admin.signOut(jwt, 'global');
      if (result.error) fail();
    });
  }catch{error=new Error('JWT_PROOF_FAILED');}
  finally{
    traceStage('CLEANUP');
    let cleanupFailed=false;
    if(created){
      // Strictly scoped novel deletion, then official Auth hard-delete (revokes
      // refresh tokens and cascades sessions). No broad cleanup or retry.
      try{sql(db,"begin; set local statement_timeout='12s'; set local lock_timeout='3s';"+
        "delete from public.novels where id="+NOVEL+" and user_id='"+ID+"'; commit;");}
      catch{cleanupFailed=true;}
      try{if(created.id!==ID || created.email!==EMAIL ||
        created.app_metadata?.internal_e2e!==true)cleanupFailed=true;
        else{const deleted=await admin.auth.admin.deleteUser(created.id);
          if(deleted.error)cleanupFailed=true;}}
      catch{cleanupFailed=true;}
    }
    traceStage('FINAL_CENSUS');
    try{audit(db,'final',created?.id||ID);fkResidue(db);}
    catch{cleanupFailed=true;}
    if(cleanupFailed)error=new Error('JWT_CLEANUP_RESIDUE_FAILED');
  }
  if(error)throw error;
  process.stdout.write('REAL_STAGING_AUTH_JWT_PROOF_PASS: application 401/200; clean\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await main();}catch{console.error('REAL_STAGING_JWT_PROOF_FAILED_OR_RESIDUE');process.exitCode=1;}
}
