// An unmounted, offline-tested owner-only author-studio preview prototype.
// No existing page imports this script. No API calls occur until mount is
// explicitly invoked after a separately approved administrator-only rollout.
(function (root) {
  'use strict';

  function workId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const raw = String(value);
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function boundedText(value, maxLength) {
    return typeof value === 'string' && value.length <= maxLength ? value : null;
  }

  // No HTML, template interpolation, innerHTML or DOM element creation from
  // unpublished story data: a single textContent assignment is the only sink.
  function previewText(payload) {
    if (
      !payload ||
      !Array.isArray(payload.characters) ||
      payload.characters.length > 100 ||
      !Array.isArray(payload.notes) ||
      payload.notes.length > 200 ||
      !Array.isArray(payload.facts) ||
      payload.facts.length > 200
    ) {
      return null;
    }
    const sections = [
      '作品カルテ（管理人限定）',
      '既存設定の読み取り専用プレビューです。AI生成は行いません。',
      '',
      '【登場人物】'
    ];
    if (payload.characters.length === 0) {
      sections.push('・まだ登録されていません（「登場人物を管理」から追加できます）。');
    }
    for (const character of payload.characters) {
      const name = boundedText(character?.name, 80);
      if (name === null) return null;
      sections.push('・' + name);
    }
    sections.push('', '【創作ノート（非公開）】');
    if (payload.notes.length === 0) {
      sections.push('・まだ登録されていません（上の創作ノートで追加できます）。');
    }
    for (const note of payload.notes) {
      const title = boundedText(note?.title, 120);
      const body = boundedText(note?.body, 20000);
      if (title === null || body === null) return null;
      sections.push('・' + title, body);
    }
    sections.push('', '【確認候補】');
    if (payload.facts.length === 0) {
      sections.push('・確認候補はありません（AIによる自動抽出は未実施です）。');
    }
    for (const fact of payload.facts) {
      const kind = boundedText(fact?.kind, 32);
      const key = boundedText(fact?.key, 120);
      if (kind === null || key === null) return null;
      sections.push('・' + kind + '：' + key);
    }
    return sections.join('\n');
  }

  // The synthetic preview is not mounted into a user page. It is a
  // text-only renderer for CI / future author-reviewed trial UI tests.
  function mockReviewText(payload) {
    if (
      payload?.mockOnly !== true ||
      payload.requiresAuthorReview !== true ||
      !Array.isArray(payload.candidates) ||
      payload.candidates.length > 36
    ) {
      return null;
    }
    const lines = [
      '作品カルテ：模擬解析（管理人限定・非公開）',
      '架空データのみ。AIの実行・設定の保存は行っていません。',
      '',
      '【作者の確認が必要な候補】'
    ];
    if (payload.candidates.length === 0) {
      lines.push('・候補はありません。');
    }
    for (const item of payload.candidates) {
      const kind = boundedText(item?.factKind, 32);
      const key = boundedText(item?.factKey, 120);
      const summary = boundedText(item?.factPayload?.summary, 320);
      const evidence = boundedText(item?.factPayload?.evidence, 160);
      const sourceId = workId(item?.sourceEpisodeId);
      if (
        kind === null ||
        key === null ||
        summary === null ||
        evidence === null ||
        !sourceId ||
        item.provenance !== 'ai_inferred' ||
        item.requiresAuthorReview !== true ||
        typeof item.conflictsWithAuthorCanon !== 'boolean'
      ) {
        return null;
      }
      lines.push(
        '・' + kind + '：' + key + '（第' + sourceId + '話ID）',
        '  候補：' + summary,
        '  本文根拠：' + evidence
      );
      if (item.conflictsWithAuthorCanon) {
        lines.push('  ※作者の確定設定と重複・衝突する可能性があります。');
      }
    }
    return lines.join('\n');
  }

  function renderText(target, value) {
    if (!target) return false;
    // A failed replacement must never leave a previous owner's data visible.
    target.hidden = true;
    target.textContent = '';
    if (value === null) return false;
    target.textContent = value;
    target.hidden = false;
    return true;
  }

  function render({ target, payload }) {
    return renderText(target, previewText(payload));
  }

  function renderMockReview({ target, payload }) {
    return renderText(target, mockReviewText(payload));
  }

  async function mount({ target, client, novelId, fetcher = root.fetch }) {
    if (!target) return false;
    // Clear any previous owner's unpublished notes before reauthenticating.
    target.hidden = true;
    target.textContent = '';
    const id = workId(novelId);
    if (!id || !client?.auth?.getSession || typeof fetcher !== 'function') {
      return false;
    }
    try {
      const { data, error } = await client.auth.getSession();
      const token = !error && data?.session?.access_token;
      if (typeof token !== 'string' || !token) return false;
      const response = await fetcher(
        '/api/ai-owner-novel-bible?novel_id=' + encodeURIComponent(id),
        {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );
      if (!response.ok) return false;
      return render({ target, payload: await response.json() });
    } catch {
      return false;
    }
  }

  root.NovelightAiBibleOwnerPanel = Object.freeze({
    mount,
    render,
    renderMockReview
  });
})(globalThis);
