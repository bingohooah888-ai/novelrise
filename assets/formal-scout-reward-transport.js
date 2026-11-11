// Unpublished browser transport for the formal Scout reader/admin panels.
// No default URL, fetch, JWT, or route is selected; the release host supplies
// the endpoint and authenticated session only after separate OWNER approval.
(function () {
  'use strict';
  function createFormalRewardTransport({
    endpoint,
    getAccessToken,
    fetchImpl
  } = {}) {
    if (
      typeof endpoint !== 'string' ||
      !/^\/[a-z0-9/_-]+$/i.test(endpoint) ||
      endpoint.includes('//') ||
      typeof getAccessToken !== 'function' ||
      typeof fetchImpl !== 'function'
    )
      throw new TypeError(
        'Approved same-origin endpoint and adapters required'
      );
    return async function request({ method = 'GET', body, query } = {}) {
      if (!['GET', 'POST'].includes(method))
        throw new TypeError('Formal reward transport method rejected');
      if (method === 'GET' && body !== undefined)
        throw new TypeError('GET body rejected');
      if (method === 'POST' && query !== undefined)
        throw new TypeError('POST query rejected');
      const token = await getAccessToken();
      if (typeof token !== 'string' || !token.trim() || /\s/.test(token))
        throw new Error('FORMAL_REWARD_SESSION_MISSING');
      const params = new URLSearchParams();
      if (query !== undefined) {
        if (
          !query ||
          Object.keys(query).length !== 1 ||
          query.view !== 'refunds'
        )
          throw new TypeError('Formal reward query rejected');
        params.set('view', 'refunds');
      }
      const url = endpoint + (params.size ? '?' + params.toString() : '');
      const res = await fetchImpl(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + token,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
        },
        ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {})
      });
      if (!res || typeof res.json !== 'function')
        throw new Error('FORMAL_REWARD_RESPONSE_INVALID');
      const data = await res.json();
      if (!res.ok || !data || typeof data !== 'object')
        throw new Error('FORMAL_REWARD_RESPONSE_REJECTED');
      return data;
    };
  }
  globalThis.NovelightFormalRewardTransport = Object.freeze({
    createFormalRewardTransport
  });
})();
