// Scoped GitHub REST transport for Community Phase 1 approval records.
// It is a dependency-injected adapter, NOT an entrypoint or authorizer.
// No environment variable lookup, CLI, default credentials, staging or Vercel.
const REPO = 'bingohooah888-ai/novelrise';
const ORIGIN = 'https://api.github.com/repos/' + REPO;
const RESERVATION = /^refs\/tags\/novelight-community-hosted-once-v1-[1-9][0-9]*$/u;
const SHA = /^[a-f0-9]{40}$/u;

function deny(message) {
  throw new Error('COMMUNITY_HOSTED_GITHUB_ADAPTER_DENIED: ' + message);
}

function requireRef(ref) {
  if (typeof ref !== 'string' || !RESERVATION.test(ref)) {
    deny('reservation ref is outside the scoped namespace');
  }
}

function requireRepo(repository) {
  if (repository !== REPO) {
    deny('unexpected GitHub repository');
  }
}

export function makeCommunityHostedGitHubAdapter({
  token,
  fetchImpl = fetch
}) {
  if (
    typeof token !== 'string' ||
    token.length < 20 ||
    /\s/u.test(token) ||
    typeof fetchImpl !== 'function'
  ) {
    deny('trusted GitHub runner token and fetch are required');
  }

  async function api(path, method = 'GET', body) {
    const url = ORIGIN + path;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined
            ? {}
            : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      deny('GitHub transport outcome unknown; do not retry automatically');
    }
    if (!Number.isInteger(response?.status)) {
      deny('GitHub response status unavailable');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      deny('GitHub response unreadable; do not retry automatically');
    }
    return { status: response.status, data };
  }

  async function loadLiveSnapshot() {
    const main = await api('/git/ref/heads/main');
    const feature = await api('/pulls/2222');
    if (main.status !== 200 || feature.status !== 200) {
      deny('fresh main or exact Draft candidate cannot be read');
    }
    const ledgerPages = [];
    for (let page = 1; page <= 20; page += 1) {
      const item = await api(
        '/issues/188/comments?per_page=100&page=' + page
      );
      if (
        item.status !== 200 ||
        !Array.isArray(item.data) ||
        item.data.length > 100
      ) {
        deny('approval ledger pagination could not be authenticated');
      }
      ledgerPages.push(item.data);
      if (item.data.length < 100) {
        return {
          main: main.data,
          feature: feature.data,
          ledgerPages
        };
      }
    }
    deny('approval ledger exceeds bounded pagination');
  }

  async function createUniqueRef({ repository, ref, sha }) {
    requireRepo(repository);
    requireRef(ref);
    if (!SHA.test(sha ?? '')) deny('reservation SHA malformed');
    const reply = await api('/git/refs', 'POST', { ref, sha });
    return {
      status: reply.status,
      ref: reply.data?.ref,
      sha: reply.data?.object?.sha
    };
  }

  async function readRef({ repository, ref }) {
    requireRepo(repository);
    requireRef(ref);
    const name = ref.slice('refs/'.length);
    const reply = await api('/git/ref/' + name);
    return {
      status: reply.status,
      ref: reply.data?.ref,
      sha: reply.data?.object?.sha
    };
  }

  async function postIssueComment({ repository, issueNumber, body }) {
    requireRepo(repository);
    if (
      issueNumber !== 188 ||
      typeof body !== 'string' ||
      body.length > 2048 ||
      !/^NOVELIGHT_STAGING_COMMUNITY_HOSTED_(CLAIMED|CONSUMED) /u.test(body)
    ) {
      deny('only exact hosted audit transitions are writable');
    }
    const reply = await api('/issues/188/comments', 'POST', { body });
    if (reply.status !== 201) {
      deny('ledger write failed or ambiguous; manual reconciliation needed');
    }
    return reply.data;
  }

  return Object.freeze({
    loadLiveSnapshot,
    createUniqueRef,
    readRef,
    postIssueComment
  });
}
