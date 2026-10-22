import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';
import {
  PROJECT_FIELDS, CONTENT_FIELDS, SPECIAL_STATUSES, validateProject,
  validateContent, approvedDigest, permissionIsValid, projectRightsDigest,
  permittedCover, permittedOgp, contentIsVisible
} from './_lib/special-core.js';

let singleton;
function database() {
  if (!singleton) {
    singleton = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return singleton;
}
async function unwrap(result) {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}
function fail(res, code, error) { return res.status(code).json({ error }); }
function pick(data, keys) {
  const selected = {};
  for (const key of keys) if (Object.hasOwn(data, key)) selected[key] = data[key];
  return selected;
}
function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.length <= 200000) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}
function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
function checkedString(value, max, field) {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) throw new Error(field + '_INVALID');
  return s;
}
async function projectOf(db, id) {
  return unwrap(db.from('special_projects').select('*').eq('id',id).single());
}
async function contentsOf(db,id) {
  return await unwrap(db.from('special_contents').select('*').eq('project_id',id)
    .order('sort_order',{ascending:true})) || [];
}
async function rightsOf(db,id) {
  return await unwrap(db.from('special_permissions').select('*').eq('project_id',id)) || [];
}
async function audit(db,actor,projectId,operation,before=null,after=null,contentId=null) {
  await unwrap(db.from('special_change_log').insert({
    actor_id:actor,project_id:projectId,content_id:contentId,
    operation,before_value:before,after_value:after
  }));
}
async function canPublish(db,id) {
  const [p, contents, rights] = await Promise.all([
    projectOf(db,id), contentsOf(db,id), rightsOf(db,id)
  ]);
  if (!p.title || !p.author_name || !p.work_title)
    return {ok:false,reason:'作家名・作品名・企画名が必要です'};
  if (!rights.some(r=>r.kind==='project' && !r.content_id
    && permissionIsValid(r,projectRightsDigest(p))))
    return {ok:false,reason:'企画紹介の掲載許諾が未確認または期限切れです'};
  if (p.cover_url && !permittedCover(p,rights))
    return {ok:false,reason:'企画画像の掲載許諾が未確認です'};
  if (p.ogp_url && !permittedOgp(p,rights))
    return {ok:false,reason:'OGP画像の掲載許諾が未確認です'};
  for (const item of contents.filter(c=>c.status==='published')) {
    if (!contentIsVisible(item,rights))
      return {ok:false,reason:'コンテンツの掲載許諾が未確認です: '+item.title};
    if (item.mode==='episode') {
      const episode = await unwrap(db.from('episodes').select('status,novel_id')
        .eq('id',item.episode_id).maybeSingle());
      if (!episode || episode.status!=='published')
        return {ok:false,reason:'紐付けたエピソードが公開されていません'};
      const novel = await unwrap(db.from('novels').select('status')
        .eq('id',episode.novel_id).maybeSingle());
      if (novel?.status!=='published')
        return {ok:false,reason:'紐付けた作品が公開されていません'};
    }
  }
  return {ok:true};
}
export function createAdminSpecialHandler({ db, env=process.env, adminGuard=requireAdmin }={}) {
  return async function handler(req,res) {
    const supabase = db || database();
    const admin = await adminGuard({req,res,supabase,env});
    if (!admin) return;
    if (!['GET','POST'].includes(req.method)) {
      res.setHeader('Allow','GET, POST');
      return fail(res,405,'METHOD_NOT_ALLOWED');
    }
    try {
      if (req.method==='GET') {
        const projects = await unwrap(supabase.from('special_projects').select('*')
          .order('updated_at',{ascending:false}).limit(200));
        const id=req.query?.id;
        if (!id) return res.status(200).json({projects:projects || []});
        if (!uuid(id)) return fail(res,400,'INVALID_ID');
        const [project,contents,permissions] = await Promise.all([
          projectOf(supabase,id), contentsOf(supabase,id), rightsOf(supabase,id)
        ]);
        const log=await unwrap(supabase.from('special_change_log')
          .select('id,operation,actor_id,created_at').eq('project_id',id)
          .order('id',{ascending:false}).limit(50));
        const events=await unwrap(supabase.from('special_events')
          .select('event_type,visitor_hash,created_at').eq('project_id',id)
          .gte('created_at',new Date(Date.now()-30*86400000).toISOString())
          .limit(5000));
        const list=events || [];
        const pageviews=list.filter(x=>x.event_type==='page_view');
        return res.status(200).json({
          project,contents,permissions,log,
          metrics:{
            last30dPageviews:pageviews.length,
            last30dVisitors:new Set(pageviews.map(x=>x.visitor_hash)).size,
            last30dContentClicks:list.filter(x=>x.event_type==='content_click').length,
            last30dNovelClicks:list.filter(x=>x.event_type==='novel_click').length,
            metricsCapped:list.length===5000
          }
        });
      }
      const b=bodyOf(req);
      if (!b || typeof b !== 'object' || Array.isArray(b) || !b.action)
        return fail(res,400,'INVALID_BODY');
      const action=b.action;
      if (action==='save_project') {
        const input=pick(b.project||{},PROJECT_FIELDS);
        validateProject(input);
        for (const key of ['featured','limited_label','pr_label'])
          if (key in input) input[key]=input[key]===true;
        if (b.id) {
          if (!uuid(b.id)) return fail(res,400,'INVALID_ID');
          const before=await projectOf(supabase,b.id);
          if (before.first_published_at && before.slug!==input.slug)
            return fail(res,409,'公開済み企画のslugは変更できません');
          const after=await unwrap(supabase.from('special_projects').update({
            ...input,updated_at:new Date().toISOString()
          }).eq('id',b.id).select('*').single());
          await audit(supabase,admin.id,b.id,'project.update',before,after);
          return res.status(200).json({project:after});
        }
        const after=await unwrap(supabase.from('special_projects').insert(input)
          .select('*').single());
        await audit(supabase,admin.id,after.id,'project.create',null,after);
        return res.status(201).json({project:after});
      }
      if (!uuid(b.id)) return fail(res,400,'INVALID_PROJECT_ID');
      const project=await projectOf(supabase,b.id);
      if (action==='clone') {
        const source=pick(project,PROJECT_FIELDS);
        const suffix=Math.random().toString(36).slice(2,8);
        const cleanSlug=project.slug.slice(0,68).replace(/-+$/,'');
        const clone=await unwrap(supabase.from('special_projects')
          .insert({...source,slug:cleanSlug+'-copy-'+suffix,featured:false,status:'draft'})
          .select('*').single());
        const contents=await contentsOf(supabase,project.id);
        if (contents.length) await unwrap(supabase.from('special_contents')
          .insert(contents.map(c=>({...pick(c,CONTENT_FIELDS),
            project_id:clone.id,status:'draft'}))));
        await audit(supabase,admin.id,clone.id,'project.clone',null,
          {source_project_id:project.id});
        return res.status(201).json({project:clone});
      }
      if (action==='save_content') {
        const input=pick(b.content||{},CONTENT_FIELDS);
        validateContent(input);
        if (input.status && !['draft','published'].includes(input.status))
          return fail(res,400,'CONTENT_STATUS_INVALID');
        if (b.content_id) {
          if (!uuid(b.content_id)) return fail(res,400,'INVALID_CONTENT_ID');
          const before=await unwrap(supabase.from('special_contents').select('*')
            .eq('id',b.content_id).eq('project_id',project.id).single());
          const after=await unwrap(supabase.from('special_contents').update({
            ...input,updated_at:new Date().toISOString()
          }).eq('id',b.content_id).eq('project_id',project.id).select('*').single());
          await audit(supabase,admin.id,project.id,'content.update',before,after,after.id);
          return res.status(200).json({content:after});
        }
        const after=await unwrap(supabase.from('special_contents').insert({
          ...input,project_id:project.id
        }).select('*').single());
        await audit(supabase,admin.id,project.id,'content.create',null,after,after.id);
        return res.status(201).json({content:after});
      }
      if (action==='approve') {
        if (b.confirm_text!=='掲載権利を確認しました')
          return fail(res,400,'APPROVAL_CONFIRMATION_REQUIRED');
        const kind=String(b.kind||''), contentId=b.content_id||null;
        if (!['project','cover','ogp','content'].includes(kind))
          return fail(res,400,'INVALID_APPROVAL_KIND');
        if (contentId&&!uuid(contentId))
          return fail(res,400,'INVALID_CONTENT_ID');
        const holder=checkedString(b.rights_holder,300,'RIGHTS_HOLDER');
        const scope=checkedString(b.permission_scope,4000,'RIGHTS_SCOPE');
        const evidence=checkedString(b.evidence_reference,1000,'RIGHTS_EVIDENCE');
        const digest=approvedDigest(project,await contentsOf(supabase,project.id),
          kind,contentId);
        if (b.expires_at && Date.parse(b.expires_at)<=Date.now())
          return fail(res,400,'RIGHTS_EXPIRED');
        const permission={
          project_id:project.id,content_id:contentId,kind,rights_holder:holder,
          permission_scope:scope,evidence_reference:evidence,
          private_notes:String(b.private_notes||'').slice(0,8000),
          approved_digest:digest,confirmed_at:new Date().toISOString(),
          approved_by:admin.id,valid_from:b.valid_from||null,expires_at:b.expires_at||null
        };
        const prior=await rightsOf(supabase,project.id);
        const active=prior.filter(p=>p.kind===kind && p.content_id===contentId && !p.revoked_at);
        if (active.length) await unwrap(supabase.from('special_permissions')
          .update({revoked_at:new Date().toISOString()})
          .in('id',active.map(p=>p.id)));
        const after=await unwrap(supabase.from('special_permissions').insert(permission)
          .select('*').single());
        await audit(supabase,admin.id,project.id,'rights.confirm',null,
          {id:after.id,kind,approved_digest:digest},contentId);
        return res.status(200).json({permission:after});
      }
      if (action==='revoke' || action==='emergency_pause') {
        if (action==='emergency_pause') await unwrap(supabase.from('special_projects')
          .update({status:'paused',updated_at:new Date().toISOString()})
          .eq('id',project.id));
        await unwrap(supabase.from('special_permissions')
          .update({revoked_at:new Date().toISOString()})
          .eq('project_id',project.id).is('revoked_at',null));
        await audit(supabase,admin.id,project.id,action,
          {status:project.status},{status:action==='emergency_pause'?'paused':project.status});
        return res.status(200).json({ok:true});
      }
      if (action==='set_status') {
        const status=String(b.status||'');
        if (!SPECIAL_STATUSES.has(status)) return fail(res,400,'INVALID_STATUS');
        if (status==='published') {
          const approval=await canPublish(supabase,project.id);
          if (!approval.ok) return fail(res,409,approval.reason);
        }
        const after=await unwrap(supabase.from('special_projects').update({
          status,updated_at:new Date().toISOString(),
          first_published_at:status==='published'
            ? (project.first_published_at||new Date().toISOString())
            : project.first_published_at
        }).eq('id',project.id).select('*').single());
        await audit(supabase,admin.id,project.id,'status.'+status,
          {status:project.status},{status:after.status});
        return res.status(200).json({project:after});
      }
      return fail(res,400,'UNKNOWN_ACTION');
    } catch (error) {
      const message=String(error?.message||'SPECIAL_OPERATION_FAILED');
      if (/_INVALID$|_TOO_LONG$/.test(message)
          || ['BODY_REQUIRED','RIGHTS_EXPIRED','APPROVAL_TARGET_INVALID'].includes(message))
        return fail(res,400,message);
      console.error('Special admin operation failed',{
        code:error?.code||null,message:message.slice(0,180)
      });
      return fail(res,503,'SPECIAL_ADMIN_UNAVAILABLE');
    }
  };
}
export default function handler(req,res) { return createAdminSpecialHandler()(req,res); }
