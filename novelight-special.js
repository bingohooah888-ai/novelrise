import {
  specialProjects,
  publishedSpecialProjects,
  findPublishedSpecial,
  safeSpecialLink
} from './novelight-special-data.js';

const byId = (id) => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function showList() {
  const list = byId('special-list');
  if (!list) return;
  list.replaceChildren();
  const projects = publishedSpecialProjects(specialProjects);
  if (!projects.length) {
    list.append(element('p', 'novelight-special-empty', '現在公開中の特別企画はありません。次の企画をお楽しみに。'));
    return;
  }
  for (const project of projects) {
    const card = element('article', 'novelight-special-card');
    const category = element('p', 'novelight-special-card-category', project.category || 'NOVELIGHT SPECIAL');
    const title = element('h3', 'novelight-special-card-title');
    const link = element('a', '', project.title);
    link.href = 'special-detail.html?slug=' + encodeURIComponent(project.slug);
    title.append(link);
    const intro = element('p', 'novelight-special-card-summary', project.summary);
    const action = element('a', 'novelight-special-text-link', '企画を見る →');
    action.href = link.href;
    card.append(category, title, intro, action);
    list.append(card);
  }
}

function showDetail() {
  const container = byId('special-detail');
  if (!container) return;
  const slug = new URLSearchParams(location.search).get('slug');
  const project = findPublishedSpecial(slug, specialProjects);
  container.replaceChildren();
  if (!project) {
    container.append(
      element('h1', 'novelight-special-detail-heading', '企画が見つかりません'),
      element('p', 'novelight-special-empty', 'この特別企画は公開されていないか、終了しました。')
    );
    document.title = '企画が見つかりません | NOVELIGHT';
    return;
  }
  document.title = project.title + ' | NOVELIGHT SPECIAL';
  const category = element('p', 'novelight-special-eyebrow', project.category || 'NOVELIGHT SPECIAL');
  const title = element('h1', 'novelight-special-detail-heading', project.title);
  const summary = element('p', 'novelight-special-detail-lead', project.summary);
  container.append(category, title, summary);
  if (project.authorName) container.append(element('p', 'novelight-special-detail-author', '参加作者：' + project.authorName));
  for (const paragraph of Array.isArray(project.body) ? project.body : []) {
    if (typeof paragraph === 'string' && paragraph.trim()) {
      container.append(element('p', 'novelight-special-detail-paragraph', paragraph));
    }
  }
  const links = Array.isArray(project.links) ? project.links : [];
  const safeLinks = links.filter((link) => link && typeof link.label === 'string' &&
    link.label.trim() && safeSpecialLink(link.href));
  if (safeLinks.length) {
    const heading = element('h2', 'novelight-special-links-heading', '作品・関連リンク');
    const actions = element('div', 'novelight-special-actions');
    for (const link of safeLinks) {
      const href = safeSpecialLink(link.href);
      const a = element('a', 'novelight-special-action', link.label);
      a.href = href;
      if (href.startsWith('https://')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      actions.append(a);
    }
    container.append(heading, actions);
  }
  byId('special-breadcrumb-current').textContent = project.title;
  container.append(element('p', 'novelight-special-notice', '作品ページの年齢確認や閲覧ルールは、NOVELIGHTの既存機能が適用されます。'));
}

if (document.body?.dataset.specialPage === 'list') showList();
if (document.body?.dataset.specialPage === 'detail') showDetail();
