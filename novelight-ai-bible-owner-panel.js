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
    return typeof value === 'string' && value.length <= maxLength
      ? value
      : null;
  }

  // Only the owner-only GET /api/ai-owner-novel-bible response belongs here.
  // The separate /api/ai-owner-bible-review list has a different contract.
  // This guard runs after server authorization; it does not grant access.
  function validPreviewResponse(payload, expectedNovelId) {
    if (
      !workId(expectedNovelId) ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload.novelId !== workId(expectedNovelId) ||
      payload.aiGenerated !== false ||
      Object.hasOwn(payload, 'candidates') ||
      !Array.isArray(payload.characters) ||
      payload.characters.length > 100 ||
      !Array.isArray(payload.notes) ||
      payload.notes.length > 200 ||
      !Array.isArray(payload.facts) ||
      payload.facts.length > 200
    )
      return false;
    let count = 0;
    for (const group of payload.facts) {
      if (
        !group ||
        typeof group !== 'object' ||
        !Array.isArray(group.confirmed) ||
        !Array.isArray(group.suggestions) ||
        (count += group.confirmed.length + group.suggestions.length) > 200
      )
        return false;
      for (const record of [...group.confirmed, ...group.suggestions]) {
        if (
          !record ||
          typeof record !== 'object' ||
          !record.payload ||
          typeof record.payload !== 'object' ||
          Array.isArray(record.payload)
        )
          return false;
      }
    }
    return true;
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
      sections.push(
        '・まだ登録されていません（「登場人物を管理」から追加できます）。'
      );
    }
    for (const character of payload.characters) {
      const name = boundedText(character?.name, 80);
      if (name === null) return null;
      sections.push('・' + name);
    }
    sections.push('', '【創作ノート（非公開）】');
    if (payload.notes.length === 0) {
      sections.push(
        '・まだ登録されていません（上の創作ノートで追加できます）。'
      );
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
        '・' + kind + '：' + key + '（参照エピソードID：' + sourceId + '）',
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

  function render({
    target,
    payload,
    outlineRows,
    reviewState,
    saveReviewState
  }) {
    // Reuse the author-ready offline UI only on an already authorized
    // preview surface. The server's existing admin-only gate is unchanged.
    const workspace = root.NovelightAiBibleAuthorWorkspace;
    if (
      typeof workspace?.render === 'function' &&
      typeof target?.appendChild === 'function'
    ) {
      return workspace.render({
        target,
        payload,
        outlineRows,
        reviewState,
        saveReviewState
      });
    }
    // An injected private chapter outline must not fall back to a
    // text-only renderer that ignores its scope/consistency checks.
    if (
      outlineRows !== undefined ||
      reviewState !== undefined ||
      saveReviewState !== undefined
    )
      return renderText(target, null);
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
      const payload = await response.json();
      if (!validPreviewResponse(payload, id)) return false;
      return render({ target, payload });
    } catch {
      return false;
    }
  }

  // Offline-only adapter for the *existing* owner GET response contract.
  // readPreview/readOutline are injected fixture readers: this function makes
  // NO HTTP, Auth, DB, or AI calls and is NOT mounted by the production page.
  // A future live caller must complete server-side auth/ownership checks first.
  function createOfflineReader({
    target,
    novelId,
    readPreview,
    readOutline,
    readReviewState,
    saveReviewState,
    doc = target?.ownerDocument || root.document
  } = {}) {
    if (!target) return null;
    target.hidden = true;
    target.textContent = '';
    const id = workId(novelId);
    if (
      !id ||
      typeof readPreview !== 'function' ||
      (readOutline !== undefined && typeof readOutline !== 'function') ||
      (readReviewState === undefined) !== (saveReviewState === undefined) ||
      (readReviewState !== undefined &&
        typeof readReviewState !== 'function') ||
      (saveReviewState !== undefined &&
        typeof saveReviewState !== 'function') ||
      typeof root.NovelightAiBibleAuthorWorkspace?.render !== 'function' ||
      typeof doc?.createElement !== 'function' ||
      typeof target.appendChild !== 'function'
    )
      return null;

    const host = doc.createElement('section');
    host.className = 'novelight-ai-bible-offline-reader';
    host.setAttribute('aria-label', '作品カルテの読み取り確認（オフライン）');
    const status = doc.createElement('p');
    status.className = 'novelight-ai-bible-load-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = '作品カルテはまだ読み込まれていません。';
    const reloadButton = doc.createElement('button');
    reloadButton.className = 'novelight-ai-bible-reload';
    reloadButton.type = 'button';
    reloadButton.textContent = '読み込む';
    const content = doc.createElement('div');
    content.className = 'novelight-ai-bible-private-content';
    content.hidden = true;
    host.appendChild(status);
    host.appendChild(reloadButton);
    host.appendChild(content);
    target.appendChild(host);
    target.hidden = false;

    let requestVersion = 0;
    let disposed = false;
    const clearPrivateContent = () => {
      content.hidden = true;
      content.textContent = '';
    };

    async function reload() {
      if (disposed) return false;
      const current = ++requestVersion;
      // Clear the previous novel's private content *before* any await.
      clearPrivateContent();
      status.textContent = '作品カルテを読み込み中…';
      reloadButton.disabled = true;
      reloadButton.textContent = '読み込み中';

      try {
        // The dependency supplies the already parsed GET response. It must
        // never be sourced from a client-declared owner/permission flag.
        const payload = await readPreview({ novelId: id });
        if (disposed || current !== requestVersion) return false;
        if (!validPreviewResponse(payload, id)) throw new Error('BAD_PREVIEW');

        let outlineRows;
        if (readOutline) {
          outlineRows = await readOutline({ novelId: id, preview: payload });
          if (disposed || current !== requestVersion) return false;
          // Do not silently drop a requested outline on read failure.
          if (!Array.isArray(outlineRows)) throw new Error('BAD_OUTLINE');
        }

        // Optional state is supplied only by a future authenticated owner
        // repository. No browser storage, new HTTP route, or DB writer here.
        let reviewState;
        if (readReviewState) {
          reviewState = await readReviewState({
            novelId: id,
            preview: payload
          });
          if (disposed || current !== requestVersion) return false;
        }
        const writer = saveReviewState
          ? async (change) => {
              if (disposed || current !== requestVersion)
                throw new Error('REVIEW_READER_STALE');
              const receipt = await saveReviewState(change);
              if (disposed || current !== requestVersion)
                throw new Error('REVIEW_READER_STALE');
              return receipt;
            }
          : undefined;
        if (
          !render({
            target: content,
            payload,
            outlineRows,
            reviewState,
            saveReviewState: writer
          })
        ) {
          throw new Error('BAD_RENDER');
        }
        status.textContent =
          payload.characters.length ||
          payload.notes.length ||
          payload.facts.length
            ? '作品カルテを読み込みました。'
            : '登録情報はまだありません。';
        reloadButton.disabled = false;
        reloadButton.textContent = '再読込';
        return true;
      } catch {
        // Do not leak unpublished material, JWTs or exception messages.
        if (!disposed && current === requestVersion) {
          clearPrivateContent();
          status.textContent = '読み込みに失敗しました。再読込してください。';
          reloadButton.disabled = false;
          reloadButton.textContent = '再読込';
        }
        return false;
      }
    }

    reloadButton.addEventListener('click', () => {
      void reload();
    });

    function dispose() {
      if (disposed) return;
      disposed = true;
      ++requestVersion;
      clearPrivateContent();
      target.hidden = true;
      target.textContent = '';
    }

    return Object.freeze({ reload, dispose });
  }

  root.NovelightAiBibleOwnerPanel = Object.freeze({
    mount,
    render,
    renderMockReview,
    validPreviewResponse,
    createOfflineReader
  });
})(globalThis);
