import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { escapeHtml, safeUrl, projectIsVisible, permittedCover, permittedOgp, contentIsVisible } from './_lib/special-core.js';

const ORIGIN = 'https://novelight.jp';
const HEADER = readFileSync(new URL('../shared/header/public-header.html', import.meta.url), 'utf8')
  .replace(/href="([a-z][a-z0-9-]*\.html)"/g, 'href="/$1"')
  .replace(/src="(assets\/[^"]+)"/g, 'src="/$1"');
const STYLES = '*{box-sizing:border-box}body{margin:0;background:#091526;color:#f7f2e8;font:16px/1.85 -apple-system,BlinkMacSystemFont,"Yu Gothic",sans-serif}a{color:#e6c992}.skip-link{position:absolute;left:-9999px}.skip-link:focus{left:10px;top:10px;z-index:10;background:white;color:#101820}.site-header{background:#111b2b;border-bottom:1px solid #716040}.public-header-inner{max-width:1150px;margin:auto;padding:14px 20px;display:flex;gap:20px;align-items:center}.logo img{max-width:160px}.site-nav{display:flex;gap:17px;flex:1}.site-nav a,.header-actions a{font-size:13px;text-decoration:none}.header-actions{display:flex;gap:9px;align-items:center}.header-actions .btn{padding:9px;border:1px solid #846d4b;border-radius:6px}.mobile-menu{display:none}.mobile-menu nav{display:flex;flex-direction:column;gap:10px;background:#142036;padding:16px;position:absolute;right:10px;z-index:9}main{max-width:1080px;margin:auto;padding:52px 20px 85px}.hero{text-align:center;margin:0 auto 45px;max-width:760px}.eyebrow{color:#dfc184;letter-spacing:.22em;font-weight:800;font-size:12px}.hero h1{font-size:clamp(30px,4vw,53px);line-height:1.35;margin:12px 0 16px}.hero p{color:#c9ccd0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.card,.block{padding:23px;border:1px solid #68583e;border-radius:14px;background:#101f32}.card h2{font-size:22px;margin:13px 0}.card p,.muted{color:#c0c8d1}.cover{height:160px;background:linear-gradient(140deg,#132744,#27304a);border-radius:9px;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#ddbf83;letter-spacing:.1em}.cover img{width:100%;height:100%;object-fit:contain}.badge{display:inline-block;border:1px solid #9b8256;color:#f1d39e;border-radius:99px;padding:2px 10px;margin-right:8px;font-size:12px}.cta{display:inline-block;margin-top:12px;padding:10px 18px;border:1px solid #cba668;border-radius:8px;text-decoration:none;font-weight:700}.empty{padding:52px 12px;text-align:center;border:1px dashed #806b47;border-radius:16px;color:#e2d8c4}.intro{max-width:780px;margin:0 auto 40px}.intro h2,.contents h2{color:#f3e2ba}.block{margin:18px 0}.body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:2.2;font-family:"Yu Mincho",serif;font-size:18px}.links{display:flex;gap:18px;flex-wrap:wrap}.back{display:inline-block;margin-bottom:26px}.footer{border-top:1px solid #665438;text-align:center;color:#a5afbc;padding:30px 15px}@media(max-width:950px){.grid{grid-template-columns:repeat(2,1fr)}.desktop-nav,.header-actions>.btn,.header-search{display:none}.mobile-menu{display:block}.public-header-inner{justify-content:space-between}}@media(max-width:580px){main{padding:30px 16px 60px}.grid{grid-template-columns:1fr}.card,.block{padding:18px}.body{font-size:16px}}';
let singleton;

function db() {
  if (!singleton) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_NOT_CONFIGURED');
    singleton = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return singleton;
}
async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
function document({ title, description, canonical, body, image = '', projectId = '' }) {
  const cleanTitle = escapeHtml(title), cleanDescription = escapeHtml(description);
  const head = '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + cleanTitle + '</title><meta name="description" content="' + cleanDescription + '">'
    + '<meta name="robots" content="index,follow">'
    + '<link rel="canonical" href="' + escapeHtml(canonical) + '">'
    + '<meta property="og:site_name" content="NOVELIGHT">'
    + '<meta property="og:type" content="article">'
    + '<meta property="og:title" content="' + cleanTitle + '">'
    + '<meta property="og:description" content="' + cleanDescription + '">'
    + '<meta property="og:url" content="' + escapeHtml(canonical) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + (image ? '<meta property="og:image" content="' + escapeHtml(image) + '"><meta name="twitter:image" content="' + escapeHtml(image) + '">' : '')
    + '<link rel="stylesheet" href="/novelight-accessibility.css"><style>' + STYLES + '</style></head>';
  return head + '<body><a class="skip-link" href="#main">本文へスキップ</a>' + HEADER
    + '<main id="main"' + (projectId ? ' data-special-project="' + escapeHtml(projectId) + '"' : '') + '>' + body + '</main><footer class="footer"><a href="/">NOVELIGHT</a>　／　<a href="/special.html">特別企画</a><p>すべての物語に、光を。</p></footer>' + (projectId ? '<script defer src="/special-analytics.js"></script>' : '') + '</body></html>';
}
function renderCover(project, permissions) {
  return permittedCover(project, permissions)
    ? '<img loading="lazy" alt="' + escapeHtml(project.title) + 'の画像" src="' + escapeHtml(safeUrl(project.cover_url, {external:true})) + '">'
    : 'NOVELIGHT SPECIAL';
}
function labelFor(kind) {
  return ({ss:'特別SS',extra:'番外編',interview:'インタビュー',other:'特別企画'})[kind] || '特別企画';
}
function indexHtml(projects, permissionsById) {
  const body = '<section class="hero"><div class="eyebrow">OFFICIAL FEATURES</div><h1>NOVELIGHT SPECIAL</h1>'
    + '<p>作品との新たな出会いをお届けする、NOVELIGHTの特別企画です。</p></section>'
    + (projects.length
      ? '<section class="grid">' + projects.map(p => {
        const rights = permissionsById.get(p.id) || [];
        return '<article class="card"><div class="cover">' + renderCover(p,rights) + '</div><p>'
          + '<span class="badge">' + labelFor(p.kind) + '</span>'
          + (p.pr_label ? '<span class="badge">PR／タイアップ</span>' : '') + '</p><h2>'
          + escapeHtml(p.title) + '</h2><p>' + escapeHtml(p.author_name) + ' ／ ' + escapeHtml(p.work_title)
          + '</p><p>' + escapeHtml(p.summary) + '</p><a class="cta" href="/special/'
          + encodeURIComponent(p.slug) + '">企画を見る →</a></article>';
      }).join('') + '</section>'
      : '<section class="empty">現在、特別企画を準備しています。</section>');
  return document({title:'NOVELIGHT SPECIAL／特別企画 | NOVELIGHT',
    description:'NOVELIGHTの作家コラボ・特別SS・番外編・インタビューをご紹介します。',
    canonical: ORIGIN+'/special.html', body});
}
function safeAnchor(url, title, eventType = '', target = '') {
  const href = safeUrl(url, {external:true});
  if (!href) return '';
  const tracked = ['content_click','official_click'].includes(eventType)
    && /^[a-z0-9-]{1,80}$/.test(target)
    ? ' data-special-event="' + eventType + '" data-special-target="' + target + '"' : '';
  return '<a' + tracked + ' href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">'
    + escapeHtml(title) + ' →</a>';
}
function detailHtml(project, permissions, contents) {
  const visible = contents.filter(c => contentIsVisible(c,permissions));
  const contentBlocks = visible.map(c => {
    let reader = '';
    if (c.mode === 'episode') reader = '<a class="cta" data-special-event="content_click" data-special-target="' + escapeHtml(c.id) + '" href="/episode.html?id='
      + encodeURIComponent(c.episode_id) + '">特別作品を無料で読む →</a>';
    if (c.mode === 'external') reader = safeAnchor(c.external_url, '外部掲載先で読む', 'content_click', c.id);
    if (c.mode === 'inline') reader = '<div class="body">' + escapeHtml(c.body || '') + '</div>';
    return '<article class="block"><span class="badge">' + escapeHtml(c.kind || labelFor(project.kind))
      + '</span><h3>' + escapeHtml(c.title) + '</h3>' + reader + '</article>';
  }).join('');
  const partners = [safeAnchor(project.author_x_url,'作家公式X','official_click','x'),
    safeAnchor(project.author_other_url,'作家公式サイト','official_click','other'),
    safeAnchor(project.work_url,'作品の公式掲載先','official_click','work'),
    project.novel_id ? '<a data-special-event="novel_click" data-special-target="' + escapeHtml(project.novel_id) + '" href="/novel.html?id=' + encodeURIComponent(project.novel_id) + '">NOVELIGHT内の作品 →</a>' : ''].filter(Boolean);
  const body = '<a class="back" href="/special.html">← 特別企画一覧へ</a>'
    + '<section class="hero"><div class="eyebrow">NOVELIGHT SPECIAL</div>'
    + (project.pr_label ? '<span class="badge">PR／タイアップ</span>' : '')
    + (project.limited_label ? '<span class="badge">期間限定</span>' : '')
    + '<h1>' + escapeHtml(project.title) + '</h1><p>' + escapeHtml(project.summary) + '</p></section>'
    + '<section class="intro"><p>' + escapeHtml(project.description) + '</p><h2>作家・作品紹介</h2>'
    + '<h3>' + escapeHtml(project.author_name) + '</h3><p>' + escapeHtml(project.author_bio) + '</p>'
    + '<h3>' + escapeHtml(project.work_title) + '</h3><p>' + escapeHtml(project.work_description) + '</p>'
    + '<div class="links">' + partners.join('') + '</div></section><section class="contents"><h2>特別コンテンツ</h2>'
    + (contentBlocks || '<p class="muted">現在、閲覧可能な特別コンテンツはありません。</p>')
    + '</section><a href="/special.html">ほかの特別企画を見る →</a>';
  const image = permittedOgp(project,permissions) ? safeUrl(project.ogp_url, {external:true}) : '';
  return document({title:project.seo_title || project.title+' | NOVELIGHT SPECIAL',
    description:project.seo_description || project.summary || 'NOVELIGHTの特別企画',
    canonical:ORIGIN+'/special/'+encodeURIComponent(project.slug),image,body,projectId:project.id});
}
function reply(req,res,status,html,indexable=true) {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Robots-Tag',indexable?'index,follow':'noindex,nofollow,noarchive');
  return res.status(status).send(req.method==='HEAD'?'':html);
}
export function createSpecialPageHandler(database=db, clock=()=>new Date()) {
  return async function handler(req,res) {
    if (!['GET','HEAD'].includes(req.method)) {
      res.setHeader('Allow','GET, HEAD'); return res.status(405).end();
    }
    const raw = Array.isArray(req.query?.slug) ? req.query.slug[0] : req.query?.slug;
    const slug = typeof raw === 'string' ? raw : '';
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return reply(req,res,404,'Not Found',false);
    try {
      const supabase = database(), now = clock();
      if (slug) {
        const items = await rows(supabase.from('special_projects').select('*')
          .eq('slug',slug).eq('status','published').limit(1));
        const project = items[0];
        if (!project) return reply(req,res,404,'Not Found',false);
        const permissions = await rows(supabase.from('special_permissions')
          .select('kind,content_id,approved_digest,confirmed_at,valid_from,expires_at,revoked_at')
          .eq('project_id',project.id));
        if (!projectIsVisible(project,permissions,now)) return reply(req,res,404,'Not Found',false);
        const contents = await rows(supabase.from('special_contents').select('*')
          .eq('project_id',project.id).eq('status','published').order('sort_order',{ascending:true}));
        return reply(req,res,200,detailHtml(project,permissions,contents));
      }
      const projects = await rows(supabase.from('special_projects').select('*').eq('status','published')
        .order('featured',{ascending:false}).order('sort_order',{ascending:true}).limit(150));
      const ids = projects.map(p=>p.id);
      const rights = ids.length ? await rows(supabase.from('special_permissions')
        .select('project_id,kind,content_id,approved_digest,confirmed_at,valid_from,expires_at,revoked_at')
        .in('project_id',ids)) : [];
      const map = new Map();
      for (const p of rights) map.set(p.project_id,[...(map.get(p.project_id)||[]),p]);
      const visible = projects.filter(p=>projectIsVisible(p,map.get(p.id)||[],now));
      return reply(req,res,200,indexHtml(visible,map));
    } catch (error) {
      // Until the reviewed DB migration has been applied, return a safe
      // empty landing rather than exposing draft work or producing fake cards.
      if (String(error?.code||'')==='42P01' || String(error?.code||'')==='PGRST205') {
        if (!slug) return reply(req,res,200,indexHtml([],new Map()));
        return reply(req,res,404,'Not Found',false);
      }
      console.error('SPECIAL render failed',{code:error?.code||null});
      return reply(req,res,503,'Temporarily unavailable',false);
    }
  };
}
export default createSpecialPageHandler();
