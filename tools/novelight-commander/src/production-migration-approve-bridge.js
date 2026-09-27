import fs from 'node:fs/promises';
import path from 'node:path';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_ISSUE = 797;
const LEDGER_ISSUE = 737;
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const REQUEST_PREFIX = 'NOVELIGHT_PRODUCTION_MIGRATION_APPROVE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_PRODUCTION_MIGRATION_APPROVE_RESULT_V1';
const CONFIRMATION = 'CHAT_PRODUCTION_APPROVED';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAIN_SHA_RE = /^[0-9a-f]{40}$/;
const CHALLENGE_RE = /^[A-F0-9]{8}$/;
const MIGRATION_RE = /^[0-9]{14}$/;
const REPAIR_VERSION = '20260815000000';

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function bounded(value, limit = 4000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
}

function normalizeMigrations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error('migrations must contain 1 to 20 migration versions.');
  }
  if (!value.every(item => typeof item === 'string' && MIGRATION_RE.test(item))) {
    throw new Error('Each migration must be exactly 14 decimal digits.');
  }
  if (new Set(value).size !== value.length) {
    throw new Error('migrations must not contain duplicates.');
  }
  const sorted = [...value].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(value)) {
    throw new Error('migrations must be sorted in canonical order.');
  }
  if (value.includes(REPAIR_VERSION)) {
    throw new Error('Baseline history repair cannot use this approval route.');
  }
  return value;
}

export function parseProductionMigrationApproveRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') {
    return null;
  }
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;

  let request;
  try {
    request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  } catch {
    throw new Error('Production migration approval request is not valid JSON.');
  }

  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('Production migration approval request keys do not match v1.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('Production migration approval request identity is invalid.');
  }
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    throw new Error('Production migration approval args must be an object.');
  }

  if (request.action === 'production_migration_preflight') {
    if (!exactKeys(request.args, ['mainSha', 'confirmation'])) {
      throw new Error('production_migration_preflight args do not match the fixed contract.');
    }
    if (!MAIN_SHA_RE.test(String(request.args.mainSha || ''))) {
      throw new Error('Production migration preflight mainSha is invalid.');
    }
    if (String(request.args.confirmation || '') !== CONFIRMATION) {
      throw new Error('Explicit chat Production approval is required.');
    }
    return request;
  }

  if (request.action === 'production_migration_deploy_approve') {
    if (!exactKeys(request.args, ['mainSha', 'challenge', 'migrations', 'confirmation'])) {
      throw new Error('production_migration_deploy_approve args do not match the fixed contract.');
    }
    if (!MAIN_SHA_RE.test(String(request.args.mainSha || ''))) {
      throw new Error('Production migration approval mainSha is invalid.');
    }
    if (!CHALLENGE_RE.test(String(request.args.challenge || ''))) {
      throw new Error('Production migration approval challenge is invalid.');
    }
    normalizeMigrations(request.args.migrations);
    if (String(request.args.confirmation || '') !== CONFIRMATION) {
      throw new Error('Explicit chat Production approval is required.');
    }
    return request;
  }

  throw new Error('Unsupported Production migration approval action.');
}

export function buildProductionMigrationApprovalBody({ mainSha, challenge, migrations }) {
  if (!MAIN_SHA_RE.test(String(mainSha || ''))) throw new Error('mainSha is invalid.');
  if (!CHALLENGE_RE.test(String(challenge || ''))) throw new Error('challenge is invalid.');
  const normalized = normalizeMigrations(migrations);
  return (
    'NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE ' +
    JSON.stringify({
      operation: 'supabase-migration-deploy',
      mainSha,
      challenge,
      migrations: normalized
    })
  );
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
    throw new Error('Production migration approval bridge identity mismatch.');
  }
  return {
    configPath,
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'production-migration-approval-state.json')
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
      'User-Agent': 'NOVELIGHT-Commander-Production-Migration-Approval'
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

async function readState(config) {
  try {
    return JSON.parse(await fs.readFile(config.statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { lastCommentId: 0, lastSeenAt: null, processedRequestIds: [] };
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

async function currentMainSha(token) {
  const ref = await githubApi(token, 'GET', `/repos/${OWNER}/${REPOSITORY}/git/ref/heads/main`);
  const sha = String(ref?.object?.sha || '');
  if (!MAIN_SHA_RE.test(sha)) throw new Error('Could not resolve current main SHA.');
  return sha;
}

async function assertCurrentMain(token, expectedSha) {
  const current = await currentMainSha(token);
  if (current !== expectedSha) {
    throw new Error(`main changed; expected ${expectedSha}, current ${current}.`);
  }
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

async function postOwnerLedgerComment(token, body) {
  const existing = (await ledgerComments(token)).find(
    comment =>
      comment?.user?.login === OWNER &&
      comment?.author_association === 'OWNER' &&
      comment?.body === body
  );
  if (existing) return { posted: false, commentId: existing.id };

  const created = await githubApi(
    token,
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${LEDGER_ISSUE}/comments`,
    { body }
  );
  if (
    created?.user?.login !== OWNER ||
    created?.author_association !== 'OWNER' ||
    created?.body !== body
  ) {
    throw new Error('GitHub did not return the expected OWNER Production ledger evidence.');
  }
  return { posted: true, commentId: created.id };
}

async function verifyMigrationFiles(token, mainSha, migrations) {
  const entries = await githubApi(
    token,
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/contents/supabase/migrations?ref=${mainSha}`
  );
  if (!Array.isArray(entries)) throw new Error('Migration directory lookup failed.');
  for (const version of migrations) {
    const matches = entries.filter(
      entry => entry?.type === 'file' && String(entry.name || '').startsWith(version + '_') && String(entry.name || '').endsWith('.sql')
    );
    if (matches.length !== 1) {
      throw new Error(`Migration ${version} did not resolve to exactly one SQL file at approved main.`);
    }
  }
}

async function executeRequest(request, token) {
  const mainSha = String(request.args.mainSha);
  await assertCurrentMain(token, mainSha);

  if (request.action === 'production_migration_preflight') {
    const body = `NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT ${mainSha}`;
    const result = await postOwnerLedgerComment(token, body);
    return [
      `main_sha: ${mainSha}`,
      `ledger_issue: ${LEDGER_ISSUE}`,
      `preflight_comment_posted: ${result.posted}`,
      `preflight_comment_id: ${result.commentId}`,
      'production_mutation_performed: false'
    ].join('\n');
  }

  const migrations = normalizeMigrations(request.args.migrations);
  await verifyMigrationFiles(token, mainSha, migrations);
  const preflightBody = `NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT ${mainSha}`;
  const hasPreflightRequest = (await ledgerComments(token)).some(
    comment =>
      comment?.user?.login === OWNER &&
      comment?.author_association === 'OWNER' &&
      comment?.body === preflightBody
  );
  if (!hasPreflightRequest) {
    throw new Error('Matching Production migration preflight request was not found in the bounded ledger.');
  }

  const approvalBody = buildProductionMigrationApprovalBody({
    mainSha,
    challenge: String(request.args.challenge),
    migrations
  });
  const result = await postOwnerLedgerComment(token, approvalBody);
  return [
    `main_sha: ${mainSha}`,
    `migrations: ${migrations.join(',')}`,
    `challenge: ${request.args.challenge}`,
    `ledger_issue: ${LEDGER_ISSUE}`,
    `approval_comment_posted: ${result.posted}`,
    `approval_comment_id: ${result.commentId}`,
    'production_mutation_performed_by_nlo: false',
    'production_execution_delegated_to_existing_github_gate: true'
  ].join('\n');
}

async function postResult(token, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request?.requestId || 'unknown'}\``,
    `- action: \`${request?.action || 'unknown'}\``,
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

async function listNewControlComments(token, state) {
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
    .filter(comment => Number(comment.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function pollOnce(config, token, state) {
  await validateControlIssue(token);
  const comments = await listNewControlComments(token, state);
  for (const comment of comments) {
    let request = null;
    try {
      request = parseProductionMigrationApproveRequest(comment);
      if (request && !state.processedRequestIds.includes(request.requestId)) {
        const details = await executeRequest(request, token);
        await postResult(token, request, 'success', details);
        state.processedRequestIds.push(request.requestId);
        state.processedRequestIds = state.processedRequestIds.slice(-200);
      }
    } catch (error) {
      if (String(comment?.body || '').startsWith(REQUEST_PREFIX)) {
        await postResult(token, request || { requestId: 'invalid', action: 'invalid' }, 'failure', error instanceof Error ? error.message : String(error));
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

export async function mainProductionMigrationApproveBridge() {
  const config = await loadConfig();
  const token = getToken();
  const state = await readState(config);
  while (true) {
    try {
      await pollOnce(config, token, state);
    } catch (error) {
      console.error('[NLO production migration approval bridge]', bounded(error instanceof Error ? error.message : String(error)));
    }
    await sleep(config.pollSeconds * 1000);
  }
}

export const productionMigrationApprovalContract = Object.freeze({
  requestPrefix: REQUEST_PREFIX,
  resultPrefix: RESULT_PREFIX,
  confirmation: CONFIRMATION,
  controlIssue: CONTROL_ISSUE,
  ledgerIssue: LEDGER_ISSUE
});
