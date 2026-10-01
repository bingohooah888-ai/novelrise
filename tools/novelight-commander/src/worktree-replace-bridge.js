import fs from 'node:fs/promises';
import path from 'node:path';
import { createSecurityConfig, resolveAllowedPath, redactSecrets } from './security.js';
import { runOnce } from './processes.js';

const OWNER='bingohooah888-ai';
const REPO='novelrise';
const ISSUE=797;
const PREFIX='NOVELIGHT_NLO_REPLACE_REQUEST ';
const RESULT='NOVELIGHT_NLO_REPLACE_RESULT ';
const SHA=/^[0-9a-f]{40}$/;
const ID=/^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9_-]{3,64}$/;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const bounded=(v,n=4000)=>{const s=redactSecrets(String(v||''));return s.length>n?s.slice(0,n)+'\n[truncated]':s;};

function safeBranch(v){const s=String(v||'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/.test(s)||/^(main|master)$/i.test(s)||s.includes('..'))throw new Error('invalid branch');return s;}
function safePath(v){const s=String(v||'').replace(/\\/g,'/').trim();const n=path.posix.normalize(s);if(!s||s.startsWith('/')||n.startsWith('../')||n.includes('/../')||n.startsWith('.git/')||n.startsWith('.github/')||n.includes('/node_modules/')||n==='node_modules')throw new Error('invalid path');return n;}
function decode(v,label){const b=Buffer.from(String(v||''),'base64');if(!b.length||b.length>64*1024||b.includes(0))throw new Error(`${label} invalid`);return b.toString('utf8');}
async function api(token,method,p,body){const r=await fetch('https://api.github.com'+p,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'NOVELIGHT-NLO-Replace'},body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const t=await r.text();let j=t;try{j=t?JSON.parse(t):null}catch{}if(!r.ok)throw new Error(`GitHub ${r.status}: ${typeof j==='object'?j?.message||JSON.stringify(j):j}`);return j;}
async function git(sec,cwd,args){const r=await runOnce('git',args,cwd,sec,120000);if(r.code!==0)throw new Error(bounded(r.stderr||r.stdout));return String(r.stdout||'').trim();}

async function main(){
 const configPath=String(process.env.NOVELIGHT_BRIDGE_CONFIG||'').trim();
 const token=String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN||'').trim();
 if(!configPath||!token)throw new Error('bridge config/token missing');
 const raw=JSON.parse(await fs.readFile(path.resolve(configPath),'utf8'));
 if(raw.owner!==OWNER||raw.repository!==REPO||Number(raw.issueNumber)!==ISSUE)throw new Error('bridge identity mismatch');
 const sec=createSecurityConfig();
 const root=sec.primary;
 const worktrees=resolveAllowedPath('.novelight-commander/worktrees',sec);
 const statePath=path.join(path.dirname(path.resolve(configPath)),'worktree-replace-state.json');
 let state={lastCommentId:0};try{state=JSON.parse(await fs.readFile(statePath,'utf8'))}catch(e){if(e?.code!=='ENOENT')throw e;}
 while(true){
  try{
   const comments=await api(token,'GET',`/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments?per_page=100&page=1`);
   for(const c of comments.filter(x=>Number(x.id)>Number(state.lastCommentId||0)).sort((a,b)=>Number(a.id)-Number(b.id))){
    state.lastCommentId=Math.max(Number(state.lastCommentId||0),Number(c.id||0));
    const body=String(c.body||'');
    if(c.user?.login===OWNER&&body.startsWith(PREFIX)){
     let req=null,status='success',details='';
     try{
      req=JSON.parse(body.slice(PREFIX.length));
      if(!ID.test(String(req.requestId||'')))throw new Error('invalid requestId');
      if(req.confirmation!=='CHAT_APPROVED')throw new Error('CHAT_APPROVED required');
      const branch=safeBranch(req.branch), rel=safePath(req.path);
      if(!SHA.test(String(req.expectedHead||'')))throw new Error('expectedHead required');
      const wt=path.join(worktrees,branch.replace(/[^A-Za-z0-9._-]/g,'_'));
      const head=await git(sec,wt,['rev-parse','HEAD']);if(head!==req.expectedHead)throw new Error(`HEAD mismatch ${head}`);
      const absolute=path.resolve(wt,rel);const check=path.relative(wt,absolute);if(check.startsWith('..')||path.isAbsolute(check))throw new Error('path escape');
      const current=await fs.readFile(absolute,'utf8');
      const oldText=decode(req.oldBase64,'oldBase64'),newText=decode(req.newBase64,'newBase64');
      const first=current.indexOf(oldText);if(first<0)throw new Error('old text not found');if(current.indexOf(oldText,first+oldText.length)>=0)throw new Error('old text is not unique');
      const next=current.slice(0,first)+newText+current.slice(first+oldText.length);await fs.writeFile(absolute,next,'utf8');
      const changed=await git(sec,wt,['status','--porcelain=v1','--',rel]);if(!changed)throw new Error('replacement produced no change');
      details=JSON.stringify({branch,path:rel,head,replaced:1,status:changed},null,2);
     }catch(e){status='failure';details=e instanceof Error?e.message:String(e);}
     await api(token,'POST',`/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments`,{body:[RESULT,'',`- request_id: \`${req?.requestId||'invalid'}\``,`- status: **${status}**`,'','~~~text',bounded(details),'~~~'].join('\n')});
    }
    const tmp=statePath+'.tmp';await fs.writeFile(tmp,JSON.stringify(state,null,2)+'\n','utf8');await fs.rename(tmp,statePath);
   }
  }catch(e){console.error('[NLO worktree replace bridge]',bounded(e instanceof Error?e.message:String(e)));}
  await sleep(Math.max(5000,Math.min(300000,Number(raw.pollSeconds||10)*1000)));
 }
}
void main().catch(e=>{console.error('[NLO worktree replace bridge] fatal:',e);process.exitCode=1;});
