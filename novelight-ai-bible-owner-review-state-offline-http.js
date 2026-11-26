// Unmounted browser adapter for the OFFLINE review-state API contract.
// No production HTML imports this script. The real route does not exist yet.
// All calls require explicit enabled=true, an owner session and a fetcher.
(function (root) {
  'use strict';

  function workId(value) {
    const raw =
      typeof value === 'number' || typeof value === 'string'
        ? String(value)
        : '';
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function validSnapshot(value, id) {
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 4 &&
      value.version === 1 &&
      value.novelId === id &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0 &&
      Array.isArray(value.reviewedIds) &&
      value.reviewedIds.length <= 100 &&
      value.reviewedIds.every(
        (key) => typeof key === 'string' && /^rv1-[0-9a-f]{16}$/.test(key)
      ) &&
      new Set(value.reviewedIds).size === value.reviewedIds.length
    );
  }

  function createOfflineReader({
    enabled = false,
    client,
    novelId,
    ownerId,
    fetcher = root.fetch
  } = {}) {
    const id = workId(novelId);
    if (
      enabled !== true ||
      !id ||
      typeof ownerId !== 'string' ||
      !ownerId ||
      typeof client?.auth?.getSession !== 'function' ||
      typeof fetcher !== 'function'
    ) {
      return null;
    }
    let pinnedToken = null;

    async function session() {
      const result = await client.auth.getSession();
      const value = result?.data?.session;
      if (
        result?.error ||
        value?.user?.id !== ownerId ||
        typeof value.access_token !== 'string' ||
        value.access_token.length < 16 ||
        (pinnedToken !== null && pinnedToken !== value.access_token)
      ) {
        throw new Error('REVIEW_SESSION_CHANGED');
      }
      if (pinnedToken === null) pinnedToken = value.access_token;
      return value.access_token;
    }

    async function request(method, change) {
      const token = await session();
      const options = {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Authorization: 'Bearer ' + token }
      };
      if (method === 'POST') {
        options.headers['Content-Type'] = 'application/json';
        options.headers['X-Novelight-Review-State'] = '1';
        options.body = JSON.stringify({
          expectedRevision: change.expectedRevision,
          reviewedIds: change.reviewedIds
        });
      }
      // This adapter has no credentials, provider calls or client-side store.
      // Origin is set by the browser; callers cannot supply a URL.
      let result;
      try {
        result = await fetcher(
          '/api/ai-owner-bible-review-state?novel_id=' + encodeURIComponent(id),
          options
        );
      } catch {
        throw new Error('REVIEW_TRANSPORT_UNAVAILABLE');
      }
      const after = await session();
      if (after !== token) throw new Error('REVIEW_SESSION_CHANGED');
      if (result?.status === 409) throw new Error('REVIEW_STATE_CONFLICT');
      if (!result?.ok) throw new Error('REVIEW_STATE_UNAVAILABLE');
      let parsed;
      try {
        parsed = await result.json();
      } catch {
        throw new Error('REVIEW_STATE_UNAVAILABLE');
      }
      const finalSession = await session();
      if (finalSession !== token || !validSnapshot(parsed, id)) {
        throw new Error('REVIEW_STATE_UNAVAILABLE');
      }
      return parsed;
    }

    return Object.freeze({
      read: async ({ novelId: requestedNovelId }) => {
        if (workId(requestedNovelId) !== id) {
          throw new Error('REVIEW_WORK_MISMATCH');
        }
        return request('GET');
      },
      save: async (change) => {
        if (
          workId(change?.novelId) !== id ||
          !Number.isSafeInteger(change?.expectedRevision) ||
          change.expectedRevision < 0 ||
          !Array.isArray(change.reviewedIds) ||
          change.reviewedIds.length > 100 ||
          change.reviewedIds.some(
            (key) => typeof key !== 'string' || !/^rv1-[0-9a-f]{16}$/.test(key)
          ) ||
          new Set(change.reviewedIds).size !== change.reviewedIds.length
        ) {
          throw new Error('REVIEW_INVALID_CHANGE');
        }
        return request('POST', change);
      }
    });
  }

  root.NovelightAiBibleReviewStateOfflineHttp = Object.freeze({
    createOfflineReader
  });
})(globalThis);
