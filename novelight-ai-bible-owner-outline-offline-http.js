// Optional author-side HTTP seam. NOT loaded by story-notes.html.
// It only becomes a reader with explicit injection AND enabled=true; no
// browser fetch, Auth, paid AI, persistence or permissions are initialized.
(function (root) {
  'use strict';

  function workId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const raw = String(value);
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function activeSession(outcome) {
    if (outcome?.error) return null;
    const session = outcome?.data?.session;
    const token = session?.access_token;
    const owner = session?.user?.id;
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/.test(token) ||
      typeof owner !== 'string' ||
      !owner
    )
      return null;
    return { token, owner };
  }

  function validResponse(body, novelId) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      body.novelId !== novelId ||
      body.aiGenerated !== false ||
      Object.hasOwn(body, 'candidates') ||
      !Array.isArray(body.outlineRows) ||
      body.outlineRows.length > 10000
    )
      return false;

    const allowed = [
      'episode_id',
      'episode_number',
      'chapter_id',
      'chapter_title',
      'chapter_position'
    ];
    return body.outlineRows.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        Object.keys(row).length === allowed.length &&
        Object.keys(row).every((key) => allowed.includes(key)) &&
        workId(row.episode_id) &&
        workId(row.episode_number) &&
        (row.chapter_id === null
          ? row.chapter_title === null && row.chapter_position === null
          : workId(row.chapter_id) &&
            workId(row.chapter_position) &&
            typeof row.chapter_title === 'string' &&
            !!row.chapter_title.trim() &&
            row.chapter_title.length <= 120)
    );
  }

  function createReader({ enabled = false, client, fetcher } = {}) {
    // Never capture the global fetch or expose an enabled default path.
    return async function readOutline({ novelId, preview } = {}) {
      const id = workId(novelId);
      if (
        enabled !== true ||
        typeof client?.auth?.getSession !== 'function' ||
        typeof fetcher !== 'function' ||
        !id ||
        !preview ||
        preview.novelId !== id ||
        preview.aiGenerated !== false
      )
        return null;

      try {
        const before = activeSession(await client.auth.getSession());
        if (!before) return null;
        // The future route must authenticate this bearer server-side.
        // Browser session equality alone is never a permission grant.
        const result = await fetcher(
          '/api/ai-owner-bible-outline?novel_id=' + encodeURIComponent(id),
          {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + before.token },
            cache: 'no-store',
            credentials: 'same-origin'
          }
        );
        if (!result?.ok) return null;
        const body = await result.json();
        const after = activeSession(await client.auth.getSession());
        if (
          !after ||
          before.owner !== after.owner ||
          before.token !== after.token ||
          !validResponse(body, id)
        )
          return null;
        return body.outlineRows;
      } catch {
        // On denial, rotation or malformed data, do not retain any private row.
        return null;
      }
    };
  }

  root.NovelightAiBibleOwnerOutlineOfflineHttp = Object.freeze({
    createReader
  });
})(globalThis);
