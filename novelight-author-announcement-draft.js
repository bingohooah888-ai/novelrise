// Local announcement drafts for the existing author-note editor.
// No AI, network, storage, publishing or social-media action.
(function (root) {
  'use strict';

  const templates = Object.freeze({
    update: ['更新のお知らせ', '更新しました。'],
    launch: ['新作のお知らせ', '新作を公開しました。'],
    complete: ['完結のお知らせ', '完結しました。'],
    introduce: ['作品紹介', '作品をご紹介します。']
  });

  function buildDraft({ kind, novelId, novelTitle, detail = '' } = {}) {
    if (
      typeof kind !== 'string' ||
      !Object.hasOwn(templates, kind) ||
      typeof novelId !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(novelId) ||
      !Number.isSafeInteger(Number(novelId)) ||
      typeof novelTitle !== 'string' ||
      !novelTitle.trim() ||
      novelTitle.length > 200 ||
      typeof detail !== 'string' ||
      detail.length > 500
    ) {
      return null;
    }
    const [label, opening] = templates[kind];
    const name = novelTitle.trim();
    const headline = label + '｜' + name;
    const title = headline.length <= 80 ? headline : label;
    const first = '『' + name + '』' + opening;
    const description = detail.trim();
    const body = [first, description, 'よろしければ作品をご覧ください。']
      .filter(Boolean)
      .join('\n\n');
    const url = 'https://novelight.jp/novel.html?id=' + encodeURIComponent(novelId);
    const social = [first, description, url].filter(Boolean).join('\n\n');
    if (body.length > 1000) return null;
    return Object.freeze({ title, body, social });
  }

  function canInsert({ ready, busy, noteId, title, body } = {}) {
    return (
      ready === true &&
      busy === false &&
      noteId === '' &&
      title === '' &&
      body === ''
    );
  }

  root.NovelightAuthorAnnouncementDraft = Object.freeze({
    buildDraft,
    canInsert
  });
})(typeof window === 'object' ? window : globalThis);
