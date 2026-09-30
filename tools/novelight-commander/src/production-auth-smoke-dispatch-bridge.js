import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_ISSUE = 797;
const LEDGER_ISSUE = 1433;
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const CONTROL_PREFIX = 'NOVELIGHT_NLO_AUTH_SMOKE_DISPATCH ';
const RESULT_PREFIX = 'NOVELIGHT_NLO_AUTH_SMOKE_DISPATCH_RESULT ';
const CONFIRMATION = 'CHAT_PRODUCTION_APPROVED';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAIN_SHA_RE = /^[0-9a-f]{40}$/;

function bounded(value, limit = 4000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
}

async function loadConfig() {
  const configPathValue = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPathValue) throw new Error('NOVELIGHT_BRIDGE_CONFIG is missing.');
  const configPath = path.resolve(configPathValue);
  const raw = JSON.parse(String(await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY || Number(raw.issueNumber) !== CONTROL_ISSUE) {
    throw new Error('Auth Smoke bridge identity mismatch.');
  }
  return {
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'production-auth-smoke-dispatch-state.json')
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
      'User-Agent': 'NOVELIGHT-Commander-Auth-Smoke-Dispatch'
    },
    signal: AbortSignal.timeout(15000),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      ? payload.message || JSON.stringify(payload)
      : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${message}`);
  }
  return payload;
}

async function readState(config) {
  try {
    return JSON.parse(await fs.readFile(config.statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { lastCommentId: 0, lastSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), processed: [] };
    }
    throw error;
  }
}

async function writeState(config, state) {
  const temp = config.statePath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(temp, config.statePath);
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

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(CONTROL_PREFIX)) return null;
  let request;
  try { request = JSON.parse(body.slice(CONTROL_PREFIX.length)); }
  catch { throw new Error('Auth Smoke dispatch request is not valid JSON.'); }
  if (Object.keys(request || {}).sort().join(',') !== 'confirmation,mainSha,requestId') {
    throw new Error('Auth Smoke dispatch request keys are invalid.');
  }
  if (request.confirmation !== CONFIRMATION) throw new Error('Explicit Production confirmation is required.');
  if (!REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Invalid requestId.');
  if (!MAIN_SHA_RE.test(String(request.mainSha || ''))) throw new Error('Invalid mainSha.');
  return request;
}

async function currentMainSha(token) {
  const ref = await githubApi(token, 'GET', `/repos/${OWNER}/${REPOSITORY}/git/ref/heads/main`);
  const sha = String(ref?.object?.sha || '');
  if (!MAIN_SHA_RE.test(sha)) throw new Error('Could not resolve current main SHA.');
  return sha;
}

async function ledgerComments(token) {
  const comments = await githubApi(
    token,
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/issues/${LEDGER_ISSUE}/comments?per_page=100`
  );
  if (!Array.isArray(comments) || comments.length >= 100) {
    throw new Error('Production Approval Ledger exceeded the bounded 100-comment contract.');
  }
  return comments;
}

async function handle(token, request) {
  const currentMain = await currentMainSha(token);
  if (currentMain !== request.mainSha) throw new Error(`main changed: ${currentMain}`);

  const challenge = randomBytes(4).toString('hex').toUpperCase();
  const approval = 'NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_APPROVE ' + JSON.stringify({
    operation: 'production-authenticated-smoke',
    mainSha: currentMain,
    challenge
  });

  const comments = await ledgerComments(token);
  if (comments.some(comment => comment?.body === approval)) {
    throw new Error('Generated Auth Smoke dispatch approval unexpectedly already exists.');
  }

  const created = await githubApi(
    token,
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${LEDGER_ISSUE}/comments`,
    { body: approval }
  );
  if (
    created?.user?.login !== OWNER ||
    created?.author_association !== 'OWNER' ||
    created?.body !== approval
  ) {
    throw new Error('GitHub did not return the expected OWNER Auth Smoke dispatch approval evidence.');
  }
  return {
    mainSha: currentMain,
    challenge,
    ledgerIssue: LEDGER_ISSUE,
    approvalCommentId: Number(created.id),
    productionMutationPerformedByNlo: false,
    executionDelegatedToExistingGithubGate: true
  };
}

async function listNewComments(token, state) {
  const comments = [];
  for (let page = 1; page <= 50; page += 1) {
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
    .filter(item => Number(item.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
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
  await githubApi(token, 'POST', `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments`, { body });
}

async function pollOnce(config, token, state) {
  await validateControlIssue(token);
  const comments = await listNewComments(token, state);
  for (const comment of comments) {
    let request = null;
    try {
      request = parseRequest(comment);
      if (request && !state.processed.includes(request.requestId)) {
        const result = await handle(token, request);
        await postResult(token, request, 'success', JSON.stringify(result, null, 2));
        state.processed.push(request.requestId);
        state.processed = state.processed.slice(-200);
      }
    } catch (error) {
      if (String(comment?.body || '').startsWith(CONTROL_PREFIX)) {
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

export async function mainProductionAuthSmokeDispatchBridge() {
  const config = await loadConfig();
  const token = getToken();
  const state = await readState(config);
  while (true) {
    try {
      await pollOnce(config, token, state);
    } catch (error) {
      console.error('[NLO Auth Smoke dispatch bridge]', bounded(error instanceof Error ? error.message : String(error)));
    }
    await sleep(config.pollSeconds * 1000);
  }
}
