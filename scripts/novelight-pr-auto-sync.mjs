// NOVELIGHT: sync owner-authored Draft PRs from current main.
// This module never checks out PR code and has no merge/approval/deploy action.
// Invoked only by trusted NLO with an existing owner-authenticated GitHub session.
import { classifyHighRiskPaths } from './high-risk-approval-lib.mjs';
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
  return ['nlo_poll', 'nlo_single'].includes(event);
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
    throw new Error('Existing NLO owner GitHub credential is required');
  }
  if (!['nlo_poll'].includes(event) &&
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
  if (['nlo_poll'].includes(event)) {
    pulls = await api(base + '/pulls?state=open&base=main&per_page=100', readToken);
    if (!Array.isArray(pulls) || pulls.length >= 100) {
      throw new Error('PR enumeration incomplete; not synchronizing any branches');
    }
  } else {
    pulls = [await api(base + '/pulls/' + prNumber, readToken)];
  }

  const eligible = pulls.filter((pr) =>
    isEligibleDraft(pr, repository) &&
    (!['nlo_poll'].includes(event) ||
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
        (['nlo_poll'].includes(event) &&
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

    // Never auto-rewrite a PR touching high-risk paths, including renamed paths.
    // This protects SHA-bound approvals even if a new approval arrives concurrently.
    const files = await api(
      base + '/pulls/' + number + '/files?per_page=100',
      readToken
    );
    if (!Array.isArray(files) || files.length === 0 || files.length >= 100 ||
        files.some((file) => typeof file?.filename !== 'string' ||
          (file.previous_filename != null &&
            typeof file.previous_filename !== 'string'))) {
      outcome.deferred.push(number);
      continue;
    }
    const changedPaths = files.flatMap((file) =>
      [file.filename, file.previous_filename].filter(Boolean)
    );
    if (classifyHighRiskPaths(changedPaths).length) {
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
    const [latestMain, latestPull, latestComments] = await Promise.all([
      getMain(),
      api(base + '/pulls/' + number, readToken),
      api(base + '/issues/' + number + '/comments?per_page=100', readToken)
    ]);
    if (latestMain.object?.sha !== currentMain ||
        latestPull.head?.sha !== live.head.sha ||
        !isEligibleDraft(latestPull, repository)) {
      throw new Error('Main or PR head moved during synchronization');
    }
    if (!Array.isArray(latestComments) || latestComments.length >= 100 ||
        latestComments.some((comment) =>
          typeof comment.body === 'string' &&
          comment.body.startsWith('NOVELIGHT_HIGH_RISK_APPROVE '))) {
      outcome.deferred.push(number);
      continue;
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
    // GitHub's native branch update is asynchronous. Confirm exact HEAD
    // contains current main; normal PR CI/CodeQL comes from synchronize.
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
      throw new Error('Branch update not verifiably complete; safe stop');
    }
    const latestBase = (await getMain()).object?.sha;
    if (latestBase !== currentMain) {
      throw new Error('main moved during native branch update; refusing stale attestation');
    }
    outcome.updated.push(number);
    log('Synced Draft PR #' + number + '; GitHub will trigger PR CI/CodeQL');
  }
  return outcome;
}

