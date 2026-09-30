import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_ISSUE = 797;
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const REQUEST_PREFIX = 'NOVELIGHT_HIGH_RISK_PR_APPROVE_REQUEST_V2 ';
const RESULT_PREFIX = 'NOVELIGHT_HIGH_RISK_PR_APPROVE_RESULT_V2';
const CONFIRMATION = 'CHAT_PRODUCTION_APPROVED';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const CHALLENGE_RE = /^[A-F0-9]{8}$/;

function bounded(value, limit = 4000) {
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
    throw new Error('High-risk approval bridge identity mismatch.');
  }
  return {
    configPath,
    repoRoot: path.resolve(String(raw.repoRoot || '')),
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'high-risk-pr-approve-v2-state.json')
  };
}

function getBridgeToken() {
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
      'User-Agent': 'NOVELIGHT-Commander-High-Risk-Approval-V2'
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
    const error = new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${message}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function runGitCredentialFill(repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error('git credential fill timed out.'));
      }
    }, 15000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
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
      if (code !== 0) {
        reject(new Error('git credential fill failed: ' + bounded(stderr, 800)));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

async function getOwnerGitCredentialToken(config) {
  const output = await runGitCredentialFill(config.repoRoot);
  const values = new Map();
  for (const line of String(output).split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  const token = String(values.get('password') || '').trim();
  if (!token) throw new Error('Git credential helper did not return a GitHub credential.');

  const identity = await githubApi(token, 'GET', '/user');
  if (identity?.login !== OWNER) {
    throw new Error('Git credential helper is not authenticated as the repository owner.');
  }
  return token;
}

function expectedChallenge(pr, headSha) {
  return createHash('sha256')
    .update('novelight-high-risk:' + pr + ':' + headSha)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;

  let request;
  try {
    request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  } catch {
    throw new Error('High-risk approval v2 request is not valid JSON.');
  }
  if (!exactKeys(request, ['version', 'requestId', 'pr', 'headSha', 'challenge', 'confirmation'])) {
    throw new Error('High-risk approval v2 request keys do not match the fixed contract.');
  }
  if (request.version !== 2 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('High-risk approval v2 request identity is invalid.');
  }
  if (!Number.isInteger(request.pr) || request.pr < 1) {
    throw new Error('High-risk approval v2 PR number is invalid.');
  }
  request.headSha = String(request.headSha || '').toLowerCase();
  request.challenge = String(request.challenge || '').toUpperCase();
  if (!SHA_RE.test(request.headSha) || !CHALLENGE_RE.test(request.challenge)) {
    throw new Error('High-risk approval v2 head SHA or challenge is invalid.');
  }
  if (String(request.confirmation || '') !== CONFIRMATION) {
    throw new Error('Explicit chat Production approval is required.');
  }
  if (request.challenge !== expectedChallenge(request.pr, request.headSha)) {
    throw new Error('High-risk approval v2 challenge does not match the exact PR head.');
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

async function loadState(config) {
  try {
    return JSON.parse(await fs.readFile(config.statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { lastCommentId: 0, lastSeenAt: null, processedRequestIds: [] };
    }
    throw error;
  }
}

async function saveState(config, state) {
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

async function findExistingApproval(token, pr, approvalBody) {
  for (let page = 1; page <= 10; page += 1) {
    const comments = await githubApi(
      token,
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${pr}/comments?per_page=100&page=${page}`
    );
    const existing = comments.find(
      comment =>
        comment?.user?.login === OWNER &&
        comment?.author_association === 'OWNER' &&
        comment?.body === approvalBody
    );
    if (existing) return existing;
    if (comments.length < 100) return null;
  }
  throw new Error('High-risk approval v2 PR comment scan exceeded the bounded 1000-comment window.');
}

async function executeRequest(request, bridgeToken, config) {
  const pull = await githubApi(
    bridgeToken,
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/pulls/${request.pr}`
  );
  if (
    pull?.state !== 'open' ||
    pull?.base?.ref !== 'main' ||
    pull?.head?.repo?.full_name !== `${OWNER}/${REPOSITORY}` ||
    String(pull?.head?.sha || '').toLowerCase() !== request.headSha
  ) {
    throw new Error('High-risk approval v2 target PR identity changed.');
  }

  const approvalBody =
    'NOVELIGHT_HIGH_RISK_APPROVE ' +
    JSON.stringify({
      operation: 'merge-high-risk-pr',
      pr: request.pr,
      headSha: request.headSha,
      challenge: request.challenge
    });

  const existing = await findExistingApproval(bridgeToken, request.pr, approvalBody);
  if (existing) {
    return [
      `pr: ${request.pr}`,
      `head_sha: ${request.headSha}`,
      `challenge: ${request.challenge}`,
      'approval_comment_posted: false',
      'approval_already_present: true',
      'approval_route: existing-owner-comment'
    ].join('\n');
  }

  let route = 'bridge-token';
  let created;
  try {
    created = await githubApi(
      bridgeToken,
      'POST',
      `/repos/${OWNER}/${REPOSITORY}/issues/${request.pr}/comments`,
      { body: approvalBody }
    );
  } catch (error) {
    if (Number(error?.status) !== 403) throw error;
    const ownerToken = await getOwnerGitCredentialToken(config);
    route = 'git-credential-owner';
    created = await githubApi(
      ownerToken,
      'POST',
      `/repos/${OWNER}/${REPOSITORY}/issues/${request.pr}/comments`,
      { body: approvalBody }
    );
  }

  if (
    created?.user?.login !== OWNER ||
    created?.author_association !== 'OWNER' ||
    created?.body !== approvalBody
  ) {
    throw new Error('GitHub did not return the expected OWNER approval evidence.');
  }

  return [
    `pr: ${request.pr}`,
    `head_sha: ${request.headSha}`,
    `challenge: ${request.challenge}`,
    'approval_comment_posted: true',
    'approval_already_present: false',
    `approval_route: ${route}`,
    'credential_value_exposed: false'
  ].join('\n');
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
    await saveState(config, state);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function mainHighRiskPrApproveBridgeV2() {
  const config = await loadConfig();
  const token = getBridgeToken();
  const state = await loadState(config);
  while (true) {
    try {
      await pollOnce(config, token, state);
    } catch (error) {
      console.error(
        '[NLO high-risk PR approval v2 bridge]',
        bounded(error instanceof Error ? error.message : String(error))
      );
    }
    await sleep(config.pollSeconds * 1000);
  }
}
