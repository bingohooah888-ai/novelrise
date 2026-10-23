/**
 * NOVELIGHT SPECIAL — 企画データの唯一の編集場所。
 *
 * 企画の追加・変更・終了は運営からチャッピーへ依頼し、この配列を変更する。
 * 専用管理画面・Supabaseテーブル・本文のコピーは不要。
 * status: 'draft' は完全非公開、'published' の企画だけ表示。
 * authorName / body / links は掲載許諾や参照先を確認してから記入。
 *
 * 形式例（公開する実在企画が決まるまで配列へ追加しない）:
 * {
 *   slug: 'example-event',
 *   status: 'draft',
 *   category: '特別企画',
 *   title: '正式に承認された企画タイトル',
 *   summary: '一覧に表示する紹介文',
 *   authorName: '掲載許諾を確認した作者名',
 *   body: ['本文ではなく、企画の紹介文を記載します。'],
 *   links: [{ label: '作品を読む', href: 'novel.html?id=123' }]
 * }
 */
export const specialProjects = Object.freeze([]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function safeSpecialLink(href) {
  if (typeof href !== 'string' || !href || href.trim() !== href) return null;
  if (/^(?:novel|episode)\.html\?/.test(href)) {
    const url = new URL(href, 'https://novelight.jp/');
    const id = url.searchParams.get('id');
    if (!/^\d+$/.test(id || '') || url.searchParams.size !== 1 || url.hash) return null;
    return url.pathname.slice(1) + '?id=' + encodeURIComponent(id);
  }
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function publishedSpecialProjects(projects = specialProjects) {
  if (!Array.isArray(projects)) return [];
  const seen = new Set();
  return projects.filter((project) => {
    if (
      !project || project.status !== 'published' ||
      typeof project.slug !== 'string' || !SLUG_PATTERN.test(project.slug) ||
      typeof project.title !== 'string' || !project.title.trim() ||
      typeof project.summary !== 'string' || !project.summary.trim() ||
      seen.has(project.slug)
    ) return false;
    seen.add(project.slug);
    return true;
  });
}

export function findPublishedSpecial(slug, projects = specialProjects) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null;
  return publishedSpecialProjects(projects).find((project) => project.slug === slug) || null;
}
