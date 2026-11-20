// Not imported by production HTML. This is the browser-to-server OFFLINE
// trial transport contract, injected only by an authorized synthetic owner UI.
// No provider configuration, paid entitlement, or model call is created here.
(function (root) {
  'use strict';

  function positive(value) {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      !/^[1-9]\d*$/.test(String(value))
    ) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }

  function validPlan(plan, novelId, episodeId) {
    if (
      !plan ||
      typeof plan !== 'object' ||
      Array.isArray(plan) ||
      Object.keys(plan).length !== 5 ||
      Object.keys(plan).some(
        (key) =>
          !['novelId', 'episodeId', 'chunkCount', 'nextChunkIndex', 'status']
            .includes(key)
      ) ||
      plan.novelId !== novelId ||
      plan.episodeId !== episodeId ||
      !Number.isSafeInteger(plan.chunkCount) ||
      plan.chunkCount < 0 ||
      plan.chunkCount > 64
    ) return false;
    const index = plan.nextChunkIndex;
    if (plan.status === 'completed' || plan.status === 'unchanged') {
      return index === null;
    }
    if (plan.status === 'zero_cost_completion') {
      return plan.chunkCount === 0 && (index === null || index === 0);
    }
    if (plan.status === 'replan_required') {
      return plan.chunkCount > 0 && index === 0;
    }
    return (
      plan.status === 'ready' &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < plan.chunkCount &&
      index < 64
    );
  }

  function unavailable() {
    throw new Error('AI_TRIAL_OFFLINE_HTTP_UNAVAILABLE');
  }

  function createOfflineTrial({
    enabled = false,
    client,
    ownerId,
    novelId,
    fetcher = root.fetch
  } = {}) {
    const work = positive(novelId);
    if (
      enabled !== true ||
      !work ||
      typeof ownerId !== 'string' ||
      !ownerId ||
      typeof client?.auth?.getSession !== 'function' ||
      typeof fetcher !== 'function'
    ) return null;
    let pinnedToken = null;
    let stopped = false;
    let inFlight = false;
    let plan = null;
    const attempted = new Set();

    async function session() {
      if (stopped) unavailable();
      const current = await client.auth.getSession();
      const value = current?.data?.session;
      const token = value?.access_token;
      if (
        current?.error ||
        value?.user?.id !== ownerId ||
        typeof token !== 'string' ||
        token.length < 16 ||
        token.length > 4096 ||
        /\s/u.test(token) ||
        (pinnedToken !== null && token !== pinnedToken)
      ) {
        stopped = true;
        plan = null;
        unavailable();
      }
      if (pinnedToken === null) pinnedToken = token;
      return token;
    }

    function requireRequest(args, token) {
      if (
        positive(args?.novelId) !== work ||
        !positive(args?.episodeId) ||
        args?.token !== token
      ) unavailable();
      return positive(args.episodeId);
    }

    async function inspectPlan(args = {}) {
      if (stopped || inFlight) unavailable();
      const token = await session();
      const episodeId = requireRequest(args, token);
      const url =
        '/api/ai-owner-bible-analyze?novel_id=' +
        work +
        '&episode_id=' +
        episodeId;
      let response;
      try {
        response = await fetcher(url, {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + token,
            'X-Novelight-Ai-Trial-Plan': '1'
          },
          cache: 'no-store',
          credentials: 'same-origin'
        });
      } catch {
        plan = null;
        unavailable();
      }
      if ((await session()) !== token || !response?.ok) {
        plan = null;
        unavailable();
      }
      let data;
      try {
        data = await response.json();
      } catch {
        plan = null;
        unavailable();
      }
      if ((await session()) !== token || !validPlan(data, work, episodeId)) {
        plan = null;
        unavailable();
      }
      if (
        data.nextChunkIndex !== null &&
        attempted.has(data.nextChunkIndex)
      ) {
        plan = null;
        unavailable();
      }
      plan = Object.freeze({
        novelId: work,
        episodeId,
        chunkCount: data.chunkCount,
        nextChunkIndex: data.nextChunkIndex,
        status: data.status
      });
      return plan;
    }

    async function stage(args = {}) {
      if (stopped || inFlight) unavailable();
      const token = await session();
      const episodeId = requireRequest(args, token);
      const index = args.chunkIndex;
      if (
        !plan ||
        plan.episodeId !== episodeId ||
        plan.nextChunkIndex !== index ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > 63 ||
        attempted.has(index)
      ) unavailable();

      // The server decides consent, fee cap and durable retry handling. Mark
      // before sending so an unknown paid outcome cannot be resent here.
      attempted.add(index);
      plan = null;
      inFlight = true;
      try {
        const response = await fetcher('/api/ai-owner-bible-analyze', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'X-Novelight-Ai-Trial': '1'
          },
          cache: 'no-store',
          credentials: 'same-origin',
          body: JSON.stringify({
            novelId: work,
            episodeId,
            chunkIndex: index
          })
        });
        if ((await session()) !== token || !response?.ok) unavailable();
        const result = await response.json();
        if (
          (await session()) !== token ||
          result?.novelId !== work ||
          !Number.isSafeInteger(result?.stagedCount) ||
          result.stagedCount < 0 ||
          result.stagedCount > 12 ||
          !(
            result.requiresAuthorReview === true ||
            (result.stagedCount === 0 &&
              result.requiresAuthorReview === false)
          )
        ) unavailable();
        return Object.freeze({
          novelId: work,
          stagedCount: result.stagedCount,
          requiresAuthorReview: result.requiresAuthorReview
        });
      } catch {
        // Unknown execution outcomes stay locked. This is NOT a provider
        // abort or budget refund; the existing Router settles server-side.
        stopped = true;
        unavailable();
      } finally {
        inFlight = false;
      }
    }

    return Object.freeze({
      enabled: true,
      inspectPlan,
      stage,
      cancelPending() {
        if (stopped || inFlight) return false;
        plan = null;
        return true;
      },
      // Local pre-submit stop only; not an independent server kill switch.
      stop() {
        stopped = true;
        plan = null;
        return !inFlight;
      }
    });
  }

  root.NovelightAiBibleTrialOfflineHttp = Object.freeze({
    createOfflineTrial
  });
})(globalThis);
