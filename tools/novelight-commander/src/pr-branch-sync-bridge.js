import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_ISSUE = 797;
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const REQUEST_PREFIX = 'NOVELIGHT_PR_BRANCH_SYNC_REQUEST_V1 ';
const RESULT_PREFIX = 'NOVELIGHT_PR_BRANCH_SYNC_RESULT_V1';
const CONFIRMATION = 'CHAT_PRODUCTION_APPROVED';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/;

function bounded(value, limit = 5000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
}

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function loadConfigPath() {
  const value = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!value) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  return path.resolve(value);
}

async function loadConfig() {
  const configPath = loadConfigPath();
  const raw = JSON.parse(String(await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY || raw.issueNumber !== CONTROL_ISSUE) {
    throw new Error('PR branch sync bridge identity mismatch.');
  }
  const repoRoot = path.resolve(String(raw.repoRoot || ''));
  if (!repoRoot) throw new Error('NLO repoRoot is missing.');
  return {
    repoRoot,
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'pr-branch-sync-state.json'),
    worktreesRoot: path.join(repoRoot, '.novelight-commander', 'worktrees')
  };
}

function getToken() {
  const token = String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  return token;
}

async function githubApi(token, method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-NLO-PR-Branch-Sync'
    },
    signal: AbortSignal.timeout(15000),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      ? payload.message || JSON.stringify(payload)
      : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${message}`);
  }
  return payload;
}

async function runGit(args, cwd, timeoutMs = 120000, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`git ${args[0] || ''} timed out.`));
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout = bounded(stdout + chunk.toString(), 12000);
    });
    child.stderr.on('data', chunk => {
      stderr = bounded(stderr + chunk.toString(), 12000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const result = { code: Number(code), stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && !allowFailure) {
        reject(new Error(`git ${args.join(' ')} failed: ${bounded(stderr || stdout, 2500)}`));
        return;
      }
      resolve(result);
    });
  });
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  let request;
  try {
    request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  } catch {
    throw new Error('PR branch sync request is not valid JSON.');
  }
  if (!exactKeys(request, ['version', 'requestId', 'pr', 'headSha', 'confirmation'])) {
    throw new Error('PR branch sync request keys do not match the fixed contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('PR branch sync request identity is invalid.');
  }
  if (!Number.isInteger(request.pr) || request.pr < 1) {
    throw new Error('PR branch sync PR number is invalid.');
  }
  request.headSha = String(request.headSha || '').toLowerCase();
  if (!SHA_RE.test(request.headSha)) throw new Error('PR branch sync head SHA is invalid.');
  if (String(request.confirmation || '') !== CONFIRMATION) {
    throw new Error('Explicit chat Production approval is required.');
  }
  return request;
}

async function validateControlIssue(token) {
  const issue = await githubApi(token, 'GET', `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}`);
  if (
    issue?.pull_request ||
    issue?.user?.login !== OWNER ||
    issue?.title !== CONTROL_TITLE ||
    !String(issue?.body || '').startsWith(CONTROL_MARKER)
  ) {
    throw new Error('NLO control issue identity failed closed.');
  }
}

async function readState(config) {
  try {
    return JSON.parse(await fs.readFile(config.statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { lastCommentId: 0, lastSeenAt: null, processedRequestIds: [] };
    }
    throw error;
  }
}

async function writeState(config, state) {
  const temp = config.statePath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(temp, config.statePath);
}

async function listNewComments(token, state) {
  const comments = [];
  for (let page = 1; page <= 30; page += 1) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) });
    if (state.lastSeenAt) query.set('since', state.lastSeenAt);
    const batch = await githubApi(
      token,
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments?${query.toString()}`
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments
    .filter(comment => Number(comment.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function assertBranch(value) {
  const branch = String(value || '');
  if (
    !BRANCH_RE.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    /^(main|master)$/i.test(branch)
  ) {
    throw new Error('PR branch sync target branch is invalid.');
  }
  return branch;
}

async function executeRequest(request, token, config) {
  const pull = await githubApi(
    token,
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/pulls/${request.pr}`
  );
  const branch = assertBranch(pull?.head?.ref);
  if (
    pull?.state !== 'open' ||
    pull?.base?.ref !== 'main' ||
    pull?.head?.repo?.full_name !== `${OWNER}/${REPOSITORY}` ||
    String(pull?.head?.sha || '').toLowerCase() !== request.headSha
  ) {
    throw new Error('PR branch sync target identity changed.');
  }

  await runGit(['fetch', '--no-tags', 'origin', branch], config.repoRoot);
  const remoteHead = (await runGit(['rev-parse', 'FETCH_HEAD'], config.repoRoot)).stdout;
  if (remoteHead !== request.headSha) {
    throw new Error(`Remote PR branch moved: expected ${request.headSha}, observed ${remoteHead}.`);
  }

  await runGit(['fetch', '--no-tags', 'origin', 'main'], config.repoRoot);
  const mainHead = (await runGit(['rev-parse', 'FETCH_HEAD'], config.repoRoot)).stdout;
  if (!SHA_RE.test(mainHead)) throw new Error('Could not resolve current origin/main.');

  const ancestry = await runGit(
    ['merge-base', '--is-ancestor', mainHead, request.headSha],
    config.repoRoot,
    120000,
    true
  );
  if (ancestry.code === 0) {
    return [
      `pr: ${request.pr}`,
      `branch: ${branch}`,
      `previous_head: ${request.headSha}`,
      `main_head: ${mainHead}`,
      `synced_head: ${request.headSha}`,
      'updated: false',
      'reason: already_contains_current_main'
    ].join('\n');
  }
  if (ancestry.code !== 1) throw new Error('Could not verify PR/main ancestry.');

  await fs.mkdir(config.worktreesRoot, { recursive: true });
  const safeRequest = request.requestId.replace(/[^A-Za-z0-9._-]/g, '_');
  const worktree = path.join(config.worktreesRoot, `pr-sync-${request.pr}-${safeRequest}`);
  try {
    await runGit(['worktree', 'add', '--detach', worktree, request.headSha], config.repoRoot);
    const status = (await runGit(['status', '--porcelain=v1'], worktree)).stdout;
    if (status) throw new Error('Fresh PR sync worktree is unexpectedly dirty.');

    const merge = await runGit(
      [
        '-c',
        'user.name=NOVELIGHT NLO',
        '-c',
        'user.email=nlo@users.noreply.github.com',
        'merge',
        '--no-ff',
        '--no-edit',
        mainHead
      ],
      worktree,
      120000,
      true
    );
    if (merge.code !== 0) {
      await runGit(['merge', '--abort'], worktree, 30000, true);
      throw new Error(`Merge current main into PR branch failed: ${bounded(merge.stderr || merge.stdout, 2500)}`);
    }

    const syncedHead = (await runGit(['rev-parse', 'HEAD'], worktree)).stdout;
    if (!SHA_RE.test(syncedHead) || syncedHead === request.headSha) {
      throw new Error('PR branch sync did not produce the expected merge commit.');
    }

    await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], worktree);
    await runGit(['fetch', '--no-tags', 'origin', branch], config.repoRoot);
    const verified = (await runGit(['rev-parse', 'FETCH_HEAD'], config.repoRoot)).stdout;
    if (verified !== syncedHead) {
      throw new Error(`PR branch sync push verification failed: ${verified}.`);
    }

    return [
      `pr: ${request.pr}`,
      `branch: ${branch}`,
      `previous_head: ${request.headSha}`,
      `main_head: ${mainHead}`,
      `synced_head: ${syncedHead}`,
      'updated: true',
      'push_mode: fast_forward_merge_commit'
    ].join('\n');
  } finally {
    await runGit(['worktree', 'remove', '--force', worktree], config.repoRoot, 60000, true);
  }
}

async function postResult(token, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request?.requestId || 'unknown'}\``,
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~text',
    bounded(details),
    '~~~'
  ].join('\n');
  await githubApi(
    token,
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments`,
    { body }
  );
}

async function pollOnce(config, token, state) {
  await validateControlIssue(token);
  const comments = await listNewComments(token, state);
  for (const comment of comments) {
    let request = null;
    try {
      request = parseRequest(comment);
      if (request && !state.processedRequestIds.includes(request.requestId)) {
        const details = await executeRequest(request, token, config);
        await postResult(token, request, 'success', details);
        state.processedRequestIds.push(request.requestId);
        state.processedRequestIds = state.processedRequestIds.slice(-200);
      }
    } catch (error) {
      if (String(comment?.body || '').startsWith(REQUEST_PREFIX)) {
        await postResult(
          token,
          request || { requestId: 'invalid' },
          'failure',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    state.lastCommentId = Math.max(Number(state.lastCommentId || 0), Number(comment.id || 0));
    state.lastSeenAt = comment.created_at || state.lastSeenAt;
    await writeState(config, state);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function mainPrBranchSyncBridge() {
  const config = await loadConfig();
  const token = getToken();
  const state = await readState(config);
  while (true) {
    try {
      await pollOnce(config, token, state);
    } catch (error) {
      console.error(
        '[NLO PR branch sync bridge]',
        bounded(error instanceof Error ? error.message : String(error))
      );
    }
    await sleep(config.pollSeconds * 1000);
  }
}
