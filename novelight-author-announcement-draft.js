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

  // No generated plot claims or silent truncation. Reuse the same validation
  // as the public-work announcement, and count Unicode code points, not X weights.
  function buildIntro({ novelId, novelTitle, detail, target } = {}) {
    if (target !== 50 && target !== 150) return null;
    if (typeof detail !== 'string' || !detail.trim()) return null;
    const draft = buildDraft({ kind: 'introduce', novelId, novelTitle, detail });
    if (!draft) return null;
    const text = '『' + novelTitle.trim() + '』\n' + detail.trim();
    const length = Array.from(text).length;
    return Object.freeze({ text, length, target, remaining: target - length });
  }

  // Author-supplied story facts only; no inference or automatic publication.
  function buildSynopsis({ novelId, novelTitle, setting, goal, conflict } = {}) {
    const fields = [setting, goal, conflict];
    if (fields.some((value) =>
      typeof value !== 'string' || !value.trim() || value.length > 180
    )) return null;
    if (!buildDraft({ kind: 'introduce', novelId, novelTitle })) return null;
    const text = '『' + novelTitle.trim() + '』\n\n' +
      fields.map((value) => value.trim()).join('\n\n');
    return Object.freeze({ text, length: Array.from(text).length });
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
    buildIntro,
    buildSynopsis,
    canInsert
  });
})(typeof window === 'object' ? window : globalThis);
