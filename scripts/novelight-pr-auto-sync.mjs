// NOVELIGHT: sync owner-authored Draft PRs from current main.
// This module never checks out PR code and has no merge/approval/deploy action.
// Uses GITHUB_TOKEN with explicit workflow_dispatch CI/CodeQL follow-up.
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREFIX = 'https://api.github.com';
const MAX_PR_UPDATES_PER_RUN = 8;
const ACTIVE_DRAFT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isEligibleDraft(pr, repository) {
  const owner = repository.split('/')[0];
  return (
    pr?.state === 'open' &&
    pr?.draft === true &&
    pr?.base?.ref === 'main' &&
    pr?.head?.repo?.full_name === repository &&
    pr?.user?.login === owner &&
    pr?.auto_merge == null &&
    Number.isSafeInteger(pr?.number) &&
    pr.number > 0 &&
    SHA.test(pr?.head?.sha || '')
  );
}

export function isRecentlyActive(pr, nowMs) {
  const updatedAt = Date.parse(pr?.updated_at || '');
  const age = nowMs - updatedAt;
  return Number.isFinite(updatedAt) &&
    Number.isFinite(nowMs) &&
    age >= 0 &&
    age <= ACTIVE_DRAFT_WINDOW_MS;
}

export function shouldUpdateBranch(comparison, pull) {
  if (!Number.isSafeInteger(comparison?.behind_by) ||
      comparison.behind_by < 0) {
    throw new Error('Unrecognized GitHub comparison; branch sync denied');
  }
  if (pull?.mergeable !== true || pull?.mergeable_state === 'dirty') {
    return false;
  }
  return comparison.behind_by > 0;
}

function validEvent(event) {
  return ['push', 'workflow_run', 'pull_request_target', 'workflow_dispatch'].includes(event);
}

export async function synchronizeDrafts({
  repository,
  event,
  prNumber = 0,
  readToken,
  writeToken,
  fetchImpl = fetch,
  nowMs = Date.now(),
  log = () => {}
}) {
  if (!REPO.test(repository || '') || !validEvent(event)) {
    throw new Error('Unexpected repository or trigger');
  }
  if (!readToken || !writeToken) {
    throw new Error('GitHub Actions token is required');
  }
  if (!['push', 'workflow_run'].includes(event) &&
      (!Number.isSafeInteger(prNumber) ||
      prNumber <= 0)) {
    throw new Error('A positive PR number is required for this trigger');
  }

  async function api(path, token, options = {}) {
    if (!path.startsWith('/repos/' + repository + '/')) {
      throw new Error('Cross-repository request denied');
    }
    const response = await fetchImpl(PREFIX + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    if (!response.ok) {
      throw new Error(
        'GitHub API failed: HTTP ' + response.status +
        ' / ' + (options.method || 'GET') + ' ' +
        path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')
      );
    }
    if (response.status === 204) return {};
    return response.json();
  }

  const base = '/repos/' + repository;
  const getMain = () => api(base + '/git/ref/heads/main', readToken);
  const currentMain = (await getMain()).object?.sha;
  if (!SHA.test(currentMain || '')) {
    throw new Error('Current main ref is not a verified SHA');
  }

  let pulls;
  if (['push', 'workflow_run'].includes(event)) {
    pulls = await api(base + '/pulls?state=open&base=main&per_page=100', readToken);
    if (!Array.isArray(pulls) || pulls.length >= 100) {
      throw new Error('PR enumeration incomplete; not synchronizing any branches');
    }
  } else {
    pulls = [await api(base + '/pulls/' + prNumber, readToken)];
  }

  const eligible = pulls.filter((pr) =>
    isEligibleDraft(pr, repository) &&
    (!['push', 'workflow_run'].includes(event) ||
      isRecentlyActive(pr, nowMs))
  );
  if (eligible.length > MAX_PR_UPDATES_PER_RUN) {
    throw new Error('Too many Draft PRs; require an explicitly bounded run');
  }

  const outcome = { checked: 0, updated: [], upToDate: [], deferred: [] };
  for (const item of eligible) {
    const number = item.number;
    outcome.checked += 1;
    const live = await api(base + '/pulls/' + number, readToken);
    if (!isEligibleDraft(live, repository) ||
        (['push', 'workflow_run'].includes(event) &&
          !isRecentlyActive(live, nowMs))) {
      outcome.deferred.push(number);
      continue;
    }

    // Never rewrite an owner-approved exact-head PR while its relay is pending.
    const comments = await api(
      base + '/issues/' + number + '/comments?per_page=100',
      readToken
    );
    if (!Array.isArray(comments) || comments.length >= 100) {
      throw new Error('Approval comment boundary is unverified');
    }
    if (comments.some((c) =>
      typeof c.body === 'string' &&
      c.body.startsWith('NOVELIGHT_HIGH_RISK_APPROVE '))) {
      outcome.deferred.push(number);
      continue;
    }

    const comparison = await api(
      base + '/compare/' + currentMain + '...' + live.head.sha,
      readToken
    );
    if (!shouldUpdateBranch(comparison, live)) {
      (comparison.behind_by === 0 ? outcome.upToDate : outcome.deferred)
        .push(number);
      continue;
    }

    // Recheck the head and main immediately before the mutation.
    const [latestMain, latestPull] = await Promise.all([
      getMain(),
      api(base + '/pulls/' + number, readToken)
    ]);
    if (latestMain.object?.sha !== currentMain ||
        latestPull.head?.sha !== live.head.sha ||
        !isEligibleDraft(latestPull, repository)) {
      throw new Error('Main or PR head moved during synchronization');
    }

    const result = await api(
      base + '/pulls/' + number + '/update-branch',
      writeToken,
      { method: 'PUT', body: { expected_head_sha: live.head.sha } }
    );
    if (typeof result.message !== 'string' ||
        !/updat/i.test(result.message)) {
      throw new Error('GitHub did not confirm update-branch request');
    }
    // GitHub's native branch update is asynchronous. Dispatch checks only
    // after the new owner-branch HEAD contains the current main.
    let newHead = null;
    for (let poll = 0; poll < 15; poll += 1) {
      const synced = await api(base + '/pulls/' + number, readToken);
      if (
        synced.head?.sha !== live.head.sha &&
        synced.head?.repo?.full_name === repository &&
        synced.head?.ref === live.head.ref &&
        isEligibleDraft(synced, repository)
      ) {
        const state = await api(
          base + '/compare/' + currentMain + '...' + synced.head.sha,
          readToken
        );
        if (state.behind_by === 0) {
          newHead = synced.head.sha;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (!SHA.test(newHead || '')) {
      throw new Error('Branch update not verifiably complete; CI dispatch blocked');
    }
    const latestBase = (await getMain()).object?.sha;
    if (latestBase !== currentMain) {
      throw new Error('main moved before CI dispatch; refusing stale attestation');
    }
    const inputs = {
      pr_number: String(number),
      expected_head_sha: newHead
    };
    for (const workflow of ['ci.yml', 'codeql.yml']) {
      await api(
        base + '/actions/workflows/' + workflow + '/dispatches',
        writeToken,
        {
          method: 'POST',
          body: { ref: live.head.ref, inputs }
        }
      );
    }
    outcome.updated.push(number);
    log('Synced Draft PR #' + number + ' and dispatched exact-HEAD CI/CodeQL');
  }
  return outcome;
}

async function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const eventNumber = Number(process.env.NOVELIGHT_PR_NUMBER || 0);
  const result = await synchronizeDrafts({
    repository: process.env.GITHUB_REPOSITORY,
    event,
    prNumber: eventNumber,
    readToken: process.env.GITHUB_TOKEN,
    writeToken: process.env.GITHUB_TOKEN,
    log: console.log
  });
  console.log('PR autosync: ' + JSON.stringify(result));
}

if (process.argv[1] && import.meta.url ===
    new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error('NOVELIGHT PR autosync stopped: ' + error.message);
    process.exitCode = 1;
  });
}
