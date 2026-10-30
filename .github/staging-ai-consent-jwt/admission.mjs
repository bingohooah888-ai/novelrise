// Pure one-use Staging approval admission. No network or secret access.
import { readFileSync } from 'node:fs';

export const PREFIX = 'NOVELIGHT_STAGING_AI_CONSENT_JWT_APPROVE ';
export const CLAIM = 'NOVELIGHT_STAGING_AI_CONSENT_JWT_CLAIMED ';
export const CONSUMED = 'NOVELIGHT_STAGING_AI_CONSENT_JWT_CONSUMED ';
const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const BASE = 'bab154c6df3b7bd5d92c4252c681810aa2fb7d96';
const SHA = /^[a-f0-9]{40}$/u;
const PINS = new Map([
  ['supabase/migrations/20261031023000_novelight_ai_external_consent.sql','7c66625a4e3a081db33390e2241a8d251dada1cd'],
  ['supabase/checks/20261031023000_novelight_ai_external_consent_precheck.sql','a6ac275618843c6df5dccf374399d7bab7d874d1'],
  ['supabase/checks/20261031023000_novelight_ai_external_consent_postcheck.sql','c9ec85ae9e2c61c88844b05e407a2ef8b1f1dafe'],
  ['supabase/rollback/20261031023000_novelight_ai_external_consent_rollback.sql','56d47ebeb6eb6fd9587380a76f9f3e238ee9ccb6']
]);
function deny() { throw new Error('STAGING_AI_CONSENT_JWT_ADMISSION_DENIED'); }
function parse(body,prefix,keys) {
  if (typeof body!=='string'||body.length>1800||!body.startsWith(prefix)) deny();
  let value;
  try { value=JSON.parse(body.slice(prefix.length)); } catch { deny(); }
  if (!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join('|')!==keys.slice().sort().join('|')) deny();
  return value;
}
export function admit({event,main,pr,files,ledgerPages,mainLineage,candidateLineage}) {
  if (event?.repository?.full_name!==REPO||event?.issue?.number!==294||
      event.issue.state!=='open'||event.issue.title!=='[Staging Control] Supabase migration sync'||
      event.issue.pull_request||event.issue.user?.login!==OWNER||
      event.comment?.user?.login!==OWNER||event.comment.author_association!=='OWNER'||
      !Number.isSafeInteger(event.comment.id)||event.comment.id<=0) deny();
  const req=parse(event.comment.body,PREFIX,
    ['scope','mainSha','candidateSha','pr','migration','confirmation']);
  if (req.scope!=='consent-auth-jwt-proof'||req.confirmation!=='STAGING AUTH JWT APPROVED'||
      req.pr!==2686||req.migration!=='20261031023000'||
      !SHA.test(req.mainSha||'')||!SHA.test(req.candidateSha||'')||
      req.mainSha===req.candidateSha||main?.object?.sha!==req.mainSha||
      pr?.number!==2686||pr.state!=='open'||pr.draft!==true||pr.merged===true||
      pr.base?.ref!=='main'||pr.head?.repo?.full_name!==REPO||
      pr.head?.sha!==req.candidateSha) deny();
  for(const [lineage,sha] of [[mainLineage,req.mainSha],[candidateLineage,req.candidateSha]]) {
    if (!lineage||!['ahead','identical'].includes(lineage.status)||
      lineage.behind_by!==0||lineage.base_commit?.sha!==BASE||
      (lineage.status==='ahead'&&lineage.commits?.at(-1)?.sha!==sha)||
      (lineage.status==='identical'&&sha!==BASE)) deny();
  }
  if (!Array.isArray(files)||files.length<PINS.size||files.length>30||
      pr.changed_files!==files.length) deny();
  for(const [path,blob] of PINS) {
    const rows=files.filter(f=>f.filename===path);
    if(rows.length!==1||rows[0].status!=='added'||rows[0].sha!==blob) deny();
  }
  if(files.some(f=>f.filename.endsWith('.sql')&&
    (f.filename.startsWith('supabase/migrations/')||
     f.filename.startsWith('supabase/checks/')||
     f.filename.startsWith('supabase/rollback/'))&&!PINS.has(f.filename))) deny();
  if(!Array.isArray(ledgerPages)||ledgerPages.length<1||ledgerPages.length>25||
    ledgerPages.some(page=>!Array.isArray(page)||page.length>100)||
    ledgerPages.at(-1).length===100) deny();
  for(const row of ledgerPages.flat()) {
    const prefix=[CLAIM,CONSUMED].find(p=>row?.body?.startsWith(p));
    if(!prefix)continue;
    const rec=parse(row.body,prefix,prefix===CLAIM?
      ['requestCommentId','mainSha','candidateSha','runId']:
      ['requestCommentId','mainSha','candidateSha','runId','result']);
    if(String(rec.requestCommentId)===String(event.comment.id))deny();
  }
  return Object.freeze({mainSha:req.mainSha,candidateSha:req.candidateSha,
    requestCommentId:String(event.comment.id),pr:2686,migration:req.migration});
}
if(process.argv[2]==='validate'){
  try {
    if(process.argv.length!==10)deny();
    const [event,main,pr,files,ledgerPages,mainLineage,candidateLineage]=
      process.argv.slice(3).map(f=>JSON.parse(readFileSync(f,'utf8')));
    process.stdout.write(JSON.stringify(admit({event,main,pr,files,ledgerPages,
      mainLineage,candidateLineage}))+'\n');
  } catch { console.error('STAGING_AI_CONSENT_JWT_ADMISSION_DENIED');process.exitCode=1; }
}
