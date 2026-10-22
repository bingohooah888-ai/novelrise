import { createHash } from 'node:crypto';

export const SPECIAL_KINDS = new Set(['ss', 'extra', 'interview', 'other']);
export const CONTENT_MODES = new Set(['episode', 'external', 'inline']);
export const SPECIAL_STATUSES = new Set(['draft', 'pending', 'published', 'paused', 'ended']);
export const PROJECT_FIELDS = ['slug','title','kind','summary','description','author_name','author_bio','author_x_url','author_other_url','work_title','work_description','work_url','novel_id','cover_url','ogp_url','featured','sort_order','starts_at','ends_at','limited_label','pr_label','seo_title','seo_description','campaign_key'];
export const CONTENT_FIELDS = ['title','kind','mode','body','episode_id','external_url','sort_order','status'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
export function safeUrl(value, {external = false} = {}) {
  if (!value) return '';
  try {
    const u = new URL(String(value), 'https://novelight.jp');
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    if (!external && !['novelight.jp', 'www.novelight.jp'].includes(u.hostname)) return '';
    return u.href;
  } catch { return ''; }
}
export function digestObject(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function projectRightsDigest(project) {
  return digestObject([project.title,project.kind,project.summary,project.description,project.author_name,project.author_bio,project.work_title,project.work_description,project.novel_id,project.author_x_url,project.author_other_url,project.work_url,project.seo_title,project.seo_description]);
}
export function coverRightsDigest(project) { return digestObject([project.cover_url]); }
export function ogpRightsDigest(project) { return digestObject([project.ogp_url]); }
export function contentRightsDigest(content) {
  return digestObject([content.title,content.kind,content.mode,content.body,content.episode_id,content.external_url]);
}
export function permissionIsValid(permission, digest, now = new Date()) {
  if (!permission || permission.approved_digest !== digest || !permission.confirmed_at || permission.revoked_at) return false;
  if (permission.expires_at && new Date(permission.expires_at).getTime() <= now.getTime()) return false;
  if (permission.valid_from && new Date(permission.valid_from).getTime() > now.getTime()) return false;
  return true;
}
export function projectWithinWindow(project, now = new Date()) {
  const instant = now.getTime();
  return project && (!project.starts_at || new Date(project.starts_at).getTime() <= instant) && (!project.ends_at || new Date(project.ends_at).getTime() > instant);
}
export function projectIsVisible(project, permissions, now = new Date()) {
  if (project?.status !== 'published' || !projectWithinWindow(project, now)) return false;
  return permissions.some(p => p.kind === 'project' && !p.content_id && permissionIsValid(p, projectRightsDigest(project), now));
}
export function permittedCover(project, permissions, now = new Date()) {
  return Boolean(project.cover_url && safeUrl(project.cover_url, {external:true}) && permissions.some(p => p.kind === 'cover' && !p.content_id && permissionIsValid(p, coverRightsDigest(project), now)));
}
export function permittedOgp(project, permissions, now = new Date()) {
  return Boolean(project.ogp_url && safeUrl(project.ogp_url, {external:true}) && permissions.some(p => p.kind === 'ogp' && !p.content_id && permissionIsValid(p, ogpRightsDigest(project), now)));
}
export function contentIsVisible(content, permissions, now = new Date()) {
  // Fail closed: inline bodies currently bypass the standard reader's
  // R15/R18 age gate and TTS settings. Publish only through existing
  // episode or approved external-link modes until the reader integration lands.
  if (content?.status !== 'published' || content.mode === 'inline') return false;
  return permissions.some(p => p.kind === 'content' && p.content_id === content.id && permissionIsValid(p, contentRightsDigest(content), now));
}
export function validateProject(input) {
  const slug = String(input.slug ?? '').trim();
  const title = String(input.title ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error('SLUG_INVALID');
  if (!title || title.length > 180) throw new Error('TITLE_INVALID');
  if (!SPECIAL_KINDS.has(input.kind)) throw new Error('KIND_INVALID');
  for(const [key,limit] of [['summary',500],['description',10000],['author_name',180],['author_bio',5000],['work_title',180],['work_description',5000],['seo_title',180],['seo_description',500],['campaign_key',120]]) {
    if (String(input[key] ?? '').length > limit) throw new Error(key.toUpperCase()+'_TOO_LONG');
  }
  if (input.starts_at && !Number.isFinite(Date.parse(input.starts_at))) throw new Error('START_INVALID');
  if (input.ends_at && !Number.isFinite(Date.parse(input.ends_at))) throw new Error('END_INVALID');
  if (input.starts_at && input.ends_at && Date.parse(input.ends_at) <= Date.parse(input.starts_at)) throw new Error('DATE_ORDER_INVALID');
  for (const k of ['author_x_url','author_other_url','work_url','cover_url','ogp_url']) {
    if (input[k] && !safeUrl(input[k], {external: true})) throw new Error(k.toUpperCase()+'_INVALID');
  }
  return true;
}
export function validateContent(input) {
  if (!String(input.title || '').trim() || String(input.title).length > 180) throw new Error('CONTENT_TITLE_INVALID');
  if (!CONTENT_MODES.has(input.mode)) throw new Error('CONTENT_MODE_INVALID');
  if (String(input.body ?? '').length > 100000) throw new Error('BODY_TOO_LONG');
  if (String(input.kind ?? '').length > 50) throw new Error('CONTENT_KIND_TOO_LONG');
  if (input.mode === 'episode' && !/^\d+$/.test(String(input.episode_id || ''))) throw new Error('EPISODE_ID_INVALID');
  if (input.mode === 'external' && !safeUrl(input.external_url, {external:true})) throw new Error('EXTERNAL_URL_INVALID');
  if (input.mode === 'inline' && !String(input.body || '').trim()) throw new Error('BODY_REQUIRED');
  return true;
}
export function approvedDigest(project, contents, kind, contentId) {
  if (kind === 'project') return projectRightsDigest(project);
  if (kind === 'cover' && project.cover_url) return coverRightsDigest(project);
  if (kind === 'ogp' && project.ogp_url) return ogpRightsDigest(project);
  if (kind === 'content') {
    const c = contents.find(row => row.id === contentId);
    if (c) return contentRightsDigest(c);
  }
  throw new Error('APPROVAL_TARGET_INVALID');
}
