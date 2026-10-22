import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { projectIsVisible } from './_lib/special-core.js';

const ALLOWED = new Set(['page_view','content_click','novel_click','official_click']);
let singleton;
function database() {
  if (!singleton) singleton = createClient(
    process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,
    { auth:{autoRefreshToken:false,persistSession:false} }
  );
  return singleton;
}
function validTarget(type,target) {
  if (type==='page_view') return target==='';
  if (type==='content_click') return /^[0-9a-f-]{36}$/i.test(target);
  if (type==='novel_click') return /^\d{1,12}$/.test(target);
  if (type==='official_click') return ['work','x','other'].includes(target);
  return false;
}
export function createSpecialEventHandler({db,env=process.env}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    if (req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const origin=String(req.headers.origin||'');
    const host=String(req.headers['x-forwarded-host']||req.headers.host||'')
      .split(',')[0].trim();
    let parsed;
    try { parsed=new URL(origin); } catch {}
    if (req.headers['sec-fetch-site']==='cross-site'
      || parsed?.protocol!=='https:' || parsed?.host!==host)
      return res.status(403).json({error:'ORIGIN_REJECTED'});
    const b=req.body;
    if (!b || typeof b!=='object' || Array.isArray(b))
      return res.status(400).json({error:'INVALID_BODY'});
    const type=String(b.event_type||''),id=String(b.project_id||''),target=String(b.target||'');
    if (!ALLOWED.has(type)
      || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
      || !validTarget(type,target))
      return res.status(400).json({error:'INVALID_EVENT'});
    const secret=String(env.NOVELIGHT_ANALYTICS_FINGERPRINT_SECRET||'');
    if (Buffer.byteLength(secret,'utf8')<32 || secret===String(env.SUPABASE_SECRET_KEY||''))
      return res.status(503).json({error:'METRICS_NOT_CONFIGURED'});
    try {
      const supabase=db||database();
      const {data:project,error}=await supabase.from('special_projects')
        .select('*').eq('id',id).eq('status','published').maybeSingle();
      if (error || !project) return res.status(200).json({accepted:false});
      const {data:rights,error:permissionError}=await supabase.from('special_permissions')
        .select('kind,content_id,approved_digest,confirmed_at,valid_from,expires_at,revoked_at')
        .eq('project_id',id);
      if (permissionError || !projectIsVisible(project,rights||[]))
        return res.status(200).json({accepted:false});
      const ip=String(req.headers['x-vercel-forwarded-for']
        ||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown')
        .split(',')[0].trim().slice(0,200);
      const now=new Date();
      const day=now.toISOString().slice(0,10);
      const hash=createHmac('sha256',secret)
        .update('novelight-special:'+day+':'+ip).digest('hex');
      const minute=new Date(Math.floor(now.getTime()/60000)*60000).toISOString();
      const {error:saveError}=await supabase.from('special_events').insert({
        project_id:id,event_type:type,target,visitor_hash:hash,event_minute:minute
      });
      if (saveError && saveError.code!=='23505') throw saveError;
      return res.status(200).json({accepted:!saveError});
    } catch(error) {
      console.error('SPECIAL analytics failed',{code:error?.code||null});
      return res.status(503).json({accepted:false});
    }
  };
}
export default createSpecialEventHandler();
