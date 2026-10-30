// Dormant trusted-main Staging-only proof; no AI model, production data or PR code.
// One reserved synthetic Auth user/novel only; their complete cleanup is mandatory.
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertPrecheck, PRECHECK_SQL } from '../staging-ai-proof/census.mjs';
import { syntheticMetadataReconcileSQL } from '../staging-ai-jwt/runner.mjs';
import { verifyStagingMigrationTarget } from '../../scripts/verify-staging-migration-target.mjs';
import { createOwnerNovelBibleConsentRuntime } from '../../api/_lib/ai/owner-novel-bible-consent-runtime.js';

const ID = '00000000-0000-4000-8000-000000000943';
const EMAIL = 'ai-review-jwt@example.invalid';
const NOVEL = 998891003;
const REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING = 'https://' + REF + '.supabase.co';
const VERSION = '20261031023000';
const POLICY = 'staging-auth-jwt-proof-v1';
const GRANT_MD5 = '055e69fb0baa0d656815521820b450fa';
const REVOKE_MD5 = '86cbb5fd44e4632b4e71751ce90ffed6';
const DISCLOSURES = [
  { processor:'openai',label:'Synthetic processor for test only',
    purpose:'Verify test consent; no external inference',
    dataSent:'No manuscript or data sent to AI',
    retention:'Synthetic test fixture only; never use in production',
    internationalTransfer:'No external transfer during this test' },
  { processor:'gemini',label:'Synthetic second processor for test only',
    purpose:'Test separate provider consent; no external inference',
    dataSent:'No manuscript or data sent to AI',
    retention:'Synthetic test fixture only; never use in production',
    internationalTransfer:'No external transfer during this test' }
];
function fail() { throw new Error('STAGING_AI_CONSENT_JWT_DENIED'); }
function phase(value) { process.stdout.write('STAGING_AI_CONSENT_JWT_PHASE: '+value+'\n'); }
function cmd(exe,args) {
  try { return execFileSync(exe,args,{encoding:'utf8',timeout:30000,
    maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).trim(); }
  catch { fail(); }
}
function sql(db,query) {
  return cmd('psql',[db,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',query]);
}
function snapshot(db) {
  const q = "select json_build_object(" +
    "'version',(select count(*) from supabase_migrations.schema_migrations where version='"+VERSION+"')," +
    "'review',(select count(*) from public.novelight_ai_review_candidates)," +
    "'runtime',(select count(*)=1 from public.novelight_ai_runtime_settings where singleton=1 and enabled=false and user_day_cap_micros=0 and user_month_cap_micros=0 and global_day_cap_micros=0 and global_month_cap_micros=0)," +
    "'grantMd5',md5(pg_get_functiondef('public.novelight_ai_consent_grant(uuid,bigint,text,text)'::regprocedure))," +
    "'revokeMd5',md5(pg_get_functiondef('public.novelight_ai_consent_revoke(uuid,bigint,text)'::regprocedure))," +
    "'consentRls',(select relrowsecurity from pg_class where oid='public.novelight_ai_external_processing_consents'::regclass)," +
    "'auditRls',(select relrowsecurity from pg_class where oid='public.novelight_ai_external_consent_action_audit'::regclass)," +
    "'rolesSafe',(not has_function_privilege('anon','public.novelight_ai_consent_grant(uuid,bigint,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.novelight_ai_consent_grant(uuid,bigint,text,text)','EXECUTE') and not has_function_privilege('anon','public.novelight_ai_consent_revoke(uuid,bigint,text)','EXECUTE') and not has_function_privilege('authenticated','public.novelight_ai_consent_revoke(uuid,bigint,text)','EXECUTE') and has_function_privilege('service_role','public.novelight_ai_consent_grant(uuid,bigint,text,text)','EXECUTE') and has_function_privilege('service_role','public.novelight_ai_consent_revoke(uuid,bigint,text)','EXECUTE') and not has_table_privilege('anon','public.novelight_ai_external_processing_consents','SELECT') and not has_table_privilege('authenticated','public.novelight_ai_external_processing_consents','SELECT') and not has_table_privilege('anon','public.novelight_ai_external_consent_action_audit','SELECT') and not has_table_privilege('authenticated','public.novelight_ai_external_consent_action_audit','SELECT') and not has_sequence_privilege('anon','public.novelight_ai_external_consent_action_audit_id_seq','USAGE') and not has_sequence_privilege('authenticated','public.novelight_ai_external_consent_action_audit_id_seq','USAGE'))," +
    "'consent',(select count(*) from public.novelight_ai_external_processing_consents where actor_id='"+ID+"'::uuid or novel_id="+NOVEL+")," +
    "'audit',(select count(*) from public.novelight_ai_external_consent_action_audit where actor_id='"+ID+"'::uuid or novel_id="+NOVEL+")," +
    "'users',(select count(*) from auth.users where id='"+ID+"'::uuid or lower(email)='"+EMAIL+"')," +
    "'identities',(select count(*) from auth.identities where user_id='"+ID+"'::uuid)," +
    "'sessions',(select count(*) from auth.sessions where user_id='"+ID+"'::uuid)," +
    "'profiles',(select count(*) from public.profiles where id='"+ID+"'::uuid)," +
    "'novels',(select count(*) from public.novels where id="+NOVEL+")," +
    "'typos',(select count(*) from public.novel_typo_report_settings where novel_id="+NOVEL+")," +
    "'beta',(select count(*) from public.beta_participants where auth_user_id='"+ID+"'::uuid or email_normalized='"+EMAIL+"')," +
    "'campaign',(select count(*) from public.scout_reward_campaign_entries where user_id='"+ID+"'::uuid)," +
    "'follows',(select count(*) from public.author_follow_events where author_user_id='"+ID+"'::uuid or novel_id="+NOVEL+")," +
    "'ranks',(select count(*) from public.novel_rank_state where author_id_snapshot='"+ID+"' or novel_id_snapshot='"+NOVEL+"')," +
    "'rankEvents',(select count(*) from public.novel_rank_events where author_id_snapshot='"+ID+"' or novel_id_snapshot='"+NOVEL+"')" +
    ')';
  let x;
  try { x=JSON.parse(sql(db,q)); } catch { fail(); }
  if(x.version!==1||x.review!==0||x.runtime!==true||
    x.grantMd5!==GRANT_MD5||x.revokeMd5!==REVOKE_MD5||
    x.consentRls!==true||x.auditRls!==true||x.rolesSafe!==true)fail();
  return x;
}
export function assertCensus(data,stage) {
  if(!['initial','fixture','final'].includes(stage))fail();
  const expected=stage==='fixture'?
    {users:1,identities:1,sessions:0,profiles:1,novels:1,typos:1,
      consent:0,audit:0,beta:0,campaign:0,follows:0,ranks:0,rankEvents:0}:
    {users:0,identities:0,sessions:0,profiles:0,novels:0,typos:0,
      consent:0,audit:0,beta:0,campaign:0,follows:0,ranks:0,rankEvents:0};
  for(const [key,value] of Object.entries(expected))if(data?.[key]!==value)fail();
  return true;
}
export function assertGate(env) {
  if(env.NOVELIGHT_STAGING_AI_CONSENT_JWT_ADMITTED!=='1'||
    env.STAGING_PROJECT_REF!==REF||env.STAGING_SUPABASE_URL!==STAGING||
    !/^[a-f0-9]{40}$/.test(env.APPROVED_MAIN_SHA||'')||
    !/^[a-f0-9]{40}$/.test(env.APPROVED_CANDIDATE_SHA||'')||
    !/^[1-9][0-9]*$/.test(env.STAGING_APPROVAL_COMMENT_ID||'')||
    !['STAGING_DATABASE_URL_FILE','STAGING_SUPABASE_SECRET_KEY',
      'STAGING_SUPABASE_PUBLISHABLE_KEY'].every(k=>typeof env[k]==='string'&&env[k].length>0))fail();
  return true;
}
function migrationParity(db) {
  const main=readdirSync('supabase/migrations')
    .map(name=>name.match(/^(20\d{12})_[a-z0-9_]+\.sql$/u)?.[1])
    .filter(Boolean).sort();
  const staging=sql(db,'select version from supabase_migrations.schema_migrations order by version')
    .split('\n').filter(Boolean).sort();
  if(main.includes(VERSION)||
    JSON.stringify([...new Set([...main,VERSION])].sort())!==JSON.stringify(staging))fail();
}
function fkResidue(db) {
  const q="select format('select count(*) from %I.%I where %I %s;',n.nspname,c.relname,a.attname,"+
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
  for(const line of sql(db,q).split('\n'))
    if(line.trim()&&sql(db,line.trim())!=='0')fail();
}
async function live() {
  const env=process.env;
  assertGate(env);
  if(cmd('git',['rev-parse','HEAD'])!==env.APPROVED_MAIN_SHA||
     cmd('gh',['api','repos/bingohooah888-ai/novelrise/git/ref/heads/main','--jq','.object.sha'])!==env.APPROVED_MAIN_SHA||
     cmd('gh',['api','repos/bingohooah888-ai/novelrise/pulls/2686','--jq','.head.sha'])!==env.APPROVED_CANDIDATE_SHA)fail();
  const db=readFileSync(env.STAGING_DATABASE_URL_FILE,'utf8').trim();
  verifyStagingMigrationTarget({STAGING_SUPABASE_URL:STAGING,STAGING_DATABASE_URL:db,PGSSLMODE:'require'});
  phase('READ_ONLY_PREFLIGHT');
  migrationParity(db);
  assertPrecheck(JSON.parse(sql(db,PRECHECK_SQL)),REF);
  assertCensus(snapshot(db),'initial');
  fkResidue(db);
  const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const admin=createClient(STAGING,env.STAGING_SUPABASE_SECRET_KEY,opts);
  const publicClient=createClient(STAGING,env.STAGING_SUPABASE_PUBLISHABLE_KEY,opts);
  const read=await admin.auth.admin.listUsers({page:1,perPage:1});
  if(read.error||!Array.isArray(read.data?.users))fail();
  let created=false,token=null,failed=false;
  try {
    const password=randomBytes(32).toString('hex');
    phase('SYNTHETIC_AUTH_CREATE');
    const result=await admin.auth.admin.createUser({
      id:ID,email:EMAIL,password,email_confirm:true,app_metadata:{internal_e2e:true}
    });
    if(result.error||result.data?.user?.id!==ID||result.data.user.email!==EMAIL||
       result.data.user.app_metadata?.internal_e2e!==true)fail();
    created=true;
    sql(db,syntheticMetadataReconcileSQL());
    phase('SYNTHETIC_NOVEL_CREATE');
    sql(db,"begin;set local statement_timeout='12s';set local lock_timeout='3s';"+
      "insert into public.novels(id,user_id,title,status) values ("+NOVEL+
      ",'"+ID+"','Synthetic consent JWT proof','draft');commit;");
    assertCensus(snapshot(db),'fixture');
    phase('REAL_AUTH_JWT');
    const login=await publicClient.auth.signInWithPassword({email:EMAIL,password});
    token=login.data?.session?.access_token||null;
    if(login.error||typeof token!=='string'||token.length<60||
      login.data?.user?.id!==ID)fail();
    const ident=await admin.auth.getUser(token);
    if(ident.error||ident.data?.user?.id!==ID)fail();
    const runtime=createOwnerNovelBibleConsentRuntime({
      enabled:true,ownerId:ID,serviceClient:admin,policyRevision:POLICY,
      disclosures:DISCLOSURES
    });
    const before=await runtime.read({token,novelId:NOVEL});
    if(before.disclosures.some(x=>x.status!=='none')||before.aiEnabled!==false)fail();
    phase('JWT_DENIAL_CHECKS');
    for(const p of [{token:'invalid-synthetic-jwt-not-authenticated',novelId:NOVEL},
                     {token,novelId:NOVEL+1}]){
      let denied=false;
      try{await runtime.read(p);}
      catch(error){denied=error.message==='AI_CONSENT_ACTION_DENIED';}
      if(!denied)fail();
    }
    phase('SYNTHETIC_GRANT');
    const granted=await runtime.grant({token,novelId:NOVEL,processor:'openai',
      explicitAuthorAction:true,acceptedExternalProcessing:true,
      acceptedDisclosureRevision:POLICY});
    if(granted.status!=='granted'||granted.aiEnabled!==false)fail();
    const active=await runtime.read({token,novelId:NOVEL});
    if(active.disclosures.find(x=>x.processor==='openai')?.status!=='active'||
       active.disclosures.find(x=>x.processor==='gemini')?.status!=='none')fail();
    phase('SYNTHETIC_REVOKE');
    const revoked=await runtime.revoke({token,novelId:NOVEL,processor:'openai',
      explicitAuthorAction:true});
    if(revoked.status!=='revoked'||revoked.aiEnabled!==false||
       (await runtime.read({token,novelId:NOVEL})).disclosures.find(x=>x.processor==='openai')?.status!=='revoked')fail();
    const counts=JSON.parse(sql(db,"select json_build_object("+
      "'consents',(select count(*) from public.novelight_ai_external_processing_consents where novel_id="+NOVEL+"),"+
      "'grants',(select count(*) from public.novelight_ai_external_consent_action_audit where novel_id="+NOVEL+" and action='granted'),"+
      "'revokes',(select count(*) from public.novelight_ai_external_consent_action_audit where novel_id="+NOVEL+" and action='revoked'))"));
    if(counts.consents!==1||counts.grants!==1||counts.revokes!==1)fail();
    phase('SYNTHETIC_PROOF_PASS');
  } catch { failed=true; }
  finally {
    phase('SYNTHETIC_CLEANUP');
    if(token)try{const r=await admin.auth.admin.signOut(token,'global');if(r.error)failed=true;}
    catch{failed=true;}
    if(created){
      try{sql(db,"begin;set local statement_timeout='12s';set local lock_timeout='3s';"+
        "delete from public.novels where id="+NOVEL+" and user_id='"+ID+"';commit;");}
      catch{failed=true;}
      try{
        const user=await admin.auth.admin.getUserById(ID);
        if(user.error||user.data?.user?.id!==ID||user.data.user.email!==EMAIL||
           user.data.user.app_metadata?.internal_e2e!==true)failed=true;
        else{const r=await admin.auth.admin.deleteUser(ID);if(r.error)failed=true;}
      }catch{failed=true;}
    }
    phase('FINAL_CENSUS');
    try{
      assertPrecheck(JSON.parse(sql(db,PRECHECK_SQL)),REF);
      assertCensus(snapshot(db),'final');
      fkResidue(db);
      migrationParity(db);
    }catch{failed=true;}
  }
  if(failed)fail();
  process.stdout.write('STAGING_AI_CONSENT_REAL_JWT_PASS: synthetic-only, no residue\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await live();}catch{console.error('STAGING_AI_CONSENT_JWT_FAILED_OR_RESIDUE');process.exitCode=1;}
}
