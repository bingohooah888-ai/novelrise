import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_PREFIX = 'NOVELIGHT_NLO_AUTH_SMOKE_DISPATCH ';
const RESULT_PREFIX = 'NOVELIGHT_NLO_AUTH_SMOKE_DISPATCH_RESULT ';
const LEDGER_ISSUE = 737;
const CONFIRMATION = 'CHAT_PRODUCTION_APPROVED';

function runGh(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `gh exited ${code}`));
      resolve(stdout.trim());
    });
  });
}

async function loadConfig() {
  const configPath = path.resolve(String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim());
  if (!process.env.NOVELIGHT_BRIDGE_CONFIG) throw new Error('NOVELIGHT_BRIDGE_CONFIG is missing.');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) throw new Error('Bridge repository identity mismatch.');
  return {
    issueNumber: Number(raw.issueNumber),
    repoRoot: path.resolve(String(raw.repoRoot || '')),
    pollSeconds: Math.max(5, Math.min(60, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'production-auth-smoke-dispatch-state.json')
  };
}

async function readState(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        lastCommentId: 0,
        lastSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        processed: []
      };
    }
    throw error;
  }
}

async function writeState(file, state) {
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(CONTROL_PREFIX)) return null;
  const request = JSON.parse(body.slice(CONTROL_PREFIX.length));
  if (Object.keys(request || {}).sort().join(',') !== 'confirmation,mainSha,requestId') throw new Error('Auth Smoke dispatch request keys are invalid.');
  if (request.confirmation !== CONFIRMATION) throw new Error('Explicit Production confirmation is required.');
  if (!/^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(String(request.requestId || ''))) throw new Error('Invalid requestId.');
  if (!/^[0-9a-f]{40}$/.test(String(request.mainSha || ''))) throw new Error('Invalid mainSha.');
  return request;
}

async function handle(config, request) {
  const currentMain = await runGh(['api', `repos/${OWNER}/${REPOSITORY}/git/ref/heads/main`, '--jq', '.object.sha'], config.repoRoot);
  if (currentMain !== request.mainSha) throw new Error(`main changed: ${currentMain}`);
  const challenge = randomBytes(4).toString('hex').toUpperCase();
  const approval = 'NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_APPROVE ' + JSON.stringify({
    operation: 'production-authenticated-smoke', mainSha: currentMain, challenge
  });
  const created = await runGh([
    'api', '--method', 'POST', `repos/${OWNER}/${REPOSITORY}/issues/${LEDGER_ISSUE}/comments`,
    '-f', `body=${approval}`, '--jq', '{id:.id,user:.user.login,body:.body}'
  ], config.repoRoot);
  const parsed = JSON.parse(created);
  if (parsed.user !== OWNER || parsed.body !== approval) throw new Error('Owner dispatch approval evidence mismatch.');
  return { mainSha: currentMain, challenge, ledgerIssue: LEDGER_ISSUE, approvalCommentId: Number(parsed.id) };
}

async function listNewComments(config, state) {
  const comments = [];
  const since = encodeURIComponent(String(state.lastSeenAt || new Date(Date.now() - 60 * 60 * 1000).toISOString()));
  for (let page = 1; page <= 10; page += 1) {
    const raw = await runGh([
      'api',
      `repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?per_page=100&page=${page}&since=${since}`
    ], config.repoRoot);
    const batch = JSON.parse(raw);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments
    .filter(item => Number(item.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function postResult(config, payload) {
  await runGh([
    'api', '--method', 'POST', `repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`,
    '-f', `body=${RESULT_PREFIX}${JSON.stringify(payload)}`
  ], config.repoRoot);
}

export async function mainProductionAuthSmokeDispatchBridge() {
  const config = await loadConfig();
  const state = await readState(config.statePath);
  while (true) {
    try {
      const comments = await listNewComments(config, state);
      for (const comment of comments) {
        let request = null;
        try {
          request = parseRequest(comment);
          if (request && !state.processed.includes(request.requestId)) {
            const result = await handle(config, request);
            await postResult(config, { requestId: request.requestId, result: 'SUCCESS', ...result });
            state.processed.push(request.requestId);
            state.processed = state.processed.slice(-200);
          }
        } catch (error) {
          if (request) {
            await postResult(config, {
              requestId: request.requestId,
              result: 'FAILURE',
              error: String(error?.message || error).slice(0, 1000)
            }).catch(() => {});
          }
        } finally {
          state.lastCommentId = Math.max(Number(state.lastCommentId || 0), Number(comment.id || 0));
          state.lastSeenAt = comment.created_at || state.lastSeenAt;
          await writeState(config.statePath, state);
        }
      }
    } catch (error) {
      console.error('[NLO Auth Smoke dispatch bridge] poll error:', String(error?.message || error).slice(0, 1000));
    }
    await new Promise(resolve => setTimeout(resolve, config.pollSeconds * 1000));
  }
}
