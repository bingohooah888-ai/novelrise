import fs from 'node:fs/promises';
import path from 'node:path';
import { createSecurityConfig } from './security.js';
import { runOnce } from './processes.js';
import { assertEditablePath } from './worktree-safe-bridge.js';

const OWNER='bingohooah888-ai';
const REPO='novelrise';
const ISSUE=797;
const PREFIX='NOVELIGHT_NLO_REPLACE_REQUEST ';
const RESULT='NOVELIGHT_NLO_REPLACE_RESULT';
const SHA=/^[0-9a-f]{40}$/;
const REQ=/^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const CONFIRM='CHAT_APPROVED';

export function replaceExactText(source, oldText, newText, expectedCount=1){
  if(!oldText)throw new Error('oldText is required.');
  const pieces=source.split(oldText);
  const count=pieces.length-1;
  if(count!==expectedCount)throw new Error(`Exact replacement count mismatch: expected ${expectedCount}, observed ${count}.`);
  return pieces.join(newText);
}

function decode(value,label){
  const buf=Buffer.from(String(value||''),'base64');
  if(!buf.length||buf.length>256*1024||buf.includes(0))throw new Error(`${label} is empty, binary, or too large.`);
  const text=buf.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(buf))throw new Error(`${label} must be valid UTF-8.`);
  return text;
}

async function api(token,method,apiPath,body){
  const response=await fetch('https://api.github.com'+apiPath,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'NOVELIGHT-NLO-Safe-Replace'},signal:AbortSignal.timeout(15000),body:body==null?undefined:JSON.stringify(body)});
  const text=await response.text();
  const payload=text?JSON.parse(text):null;
  if(!response.ok)throw new Error(payload?.message||`GitHub API ${response.status}`);
  return payload;
}

async function load(){
  const configPath=String(process.env.NOVELIGHT_BRIDGE_CONFIG||'').trim();
  if(!configPath)throw new Error('NOVELIGHT_BRIDGE_CONFIG is missing.');
  const raw=JSON.parse(await fs.readFile(path.resolve(configPath),'utf8'));
  if(raw.owner!==OWNER||raw.repository!==REPO||Number(raw.issueNumber)!==ISSUE)throw new Error('Bridge identity mismatch.');
  const security=createSecurityConfig();
  return {security,root:security.primary,state:path.join(path.dirname(path.resolve(configPath)),'worktree-safe-replace-state.json'),worktrees:path.join(security.primary,'.novelight-commander','worktrees'),poll:Math.max(5,Math.min(300,Number(raw.pollSeconds||10)))};
}

async function readState(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e?.code==='ENOENT')return{last:0,processed:[]};throw e}}
async function saveState(file,state){await fs.writeFile(file,JSON.stringify(state,null,2)+'\n','utf8')}
function slug(branch){return branch.replace(/[^A-Za-z0-9._-]/g,'_')}
async function git(config,args,cwd){const r=await runOnce('git',args,cwd||config.root,config.security,120000);if(r.code!==0)throw new Error(String(r.stderr||r.stdout||'git failed'));return String(r.stdout||'').trim()}

function parse(comment){
  if(comment?.user?.login!==OWNER||comment?.author_association!=='OWNER')return null;
  const body=String(comment.body||'');if(!body.startsWith(PREFIX))return null;
  const req=JSON.parse(body.slice(PREFIX.length));
  if(!REQ.test(String(req.requestId||'')))throw new Error('Invalid requestId.');
  if(req.confirmation!==CONFIRM)throw new Error('CHAT_APPROVED is required.');
  const branch=String(req.branch||'');if(!branch||/^(main|master)$/i.test(branch)||branch.includes('..'))throw new Error('Invalid branch.');
  if(!SHA.test(String(req.expectedHead||'')))throw new Error('expectedHead is required.');
  req.path=assertEditablePath(req.path);
  req.expectedCount=Number(req.expectedCount??1);
  if(!Number.isInteger(req.expectedCount)||req.expectedCount<1||req.expectedCount>20)throw new Error('Invalid expectedCount.');
  return req;
}

async function apply(config,req){
  const dir=path.join(config.worktrees,slug(req.branch));
  const head=await git(config,['rev-parse','HEAD'],dir);
  if(head!==req.expectedHead)throw new Error(`Worktree HEAD mismatch: expected ${req.expectedHead}, observed ${head}.`);
  const status=await git(config,['status','--porcelain=v1'],dir);
  if(status)throw new Error('Worktree must be clean before exact replacement.');
  const file=path.resolve(dir,req.path);const rel=path.relative(dir,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Path escaped worktree.');
  const source=await fs.readFile(file,'utf8');
  const oldText=decode(req.oldTextBase64,'oldText');const newText=decode(req.newTextBase64,'newText');
  const updated=replaceExactText(source,oldText,newText,req.expectedCount);
  await fs.writeFile(file,updated,'utf8');
  const changed=await git(config,['status','--porcelain=v1','--',req.path],dir);
  if(!changed)throw new Error('Replacement produced no change.');
  return {branch:req.branch,head,path:req.path,expectedCount:req.expectedCount,status:changed};
}

async function post(token,req,status,details){await api(token,'POST',`/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments`,{body:[RESULT,'',`- request_id: \`${req?.requestId||'invalid'}\``,`- status: **${status}**`,`- observed_at: \`${new Date().toISOString()}\``,'','~~~text',String(details).slice(0,5000),'~~~'].join('\n')})}

export async function mainWorktreeSafeReplaceBridge(){
  const config=await load();const token=String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN||'').trim();if(!token)throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');const state=await readState(config.state);
  while(true){
    try{
      const comments=await api(token,'GET',`/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments?per_page=100&page=1`);
      for(const comment of comments.filter(x=>Number(x.id)>Number(state.last||0)).sort((a,b)=>Number(a.id)-Number(b.id))){
        let req=null;try{req=parse(comment);if(req&&!state.processed.includes(req.requestId)){const result=await apply(config,req);await post(token,req,'success',JSON.stringify(result,null,2));state.processed.push(req.requestId);state.processed=state.processed.slice(-200)}}catch(e){if(String(comment?.body||'').startsWith(PREFIX))await post(token,req,'failure',e instanceof Error?e.message:String(e))}
        state.last=Math.max(Number(state.last||0),Number(comment.id||0));await saveState(config.state,state);
      }
    }catch(e){console.error('[NLO safe replace]',e)}
    await new Promise(r=>setTimeout(r,config.poll*1000));
  }
}
