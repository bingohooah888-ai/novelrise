import fs from 'node:fs/promises';
import path from 'node:path';
import { bootstrapChatgptPlugin } from './chatgpt-plugin-bootstrap-v2.js';
import { redactSecrets } from './security.js';

const OWNER = 'bingohooah888-ai';
const REPO = 'novelrise';
const ISSUE = 797;
const PREFIX = 'NOVELIGHT_NLO_CHATGPT_PLUGIN_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_NLO_CHATGPT_PLUGIN_RESULT';
const CONFIRMATION = 'CHAT_APPROVED';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

async function loadConfig() {
  const configPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG missing.');
  const resolved = path.resolve(configPath);
  const raw = JSON.parse(await fs.readFile(resolved, 'utf8'));
  if (raw.owner !== OWNER || raw.repository !== REPO || Number(raw.issueNumber) !== ISSUE) throw new Error('Bridge identity mismatch.');
  const bridgeRoot = path.dirname(resolved);
  const sharedDataRoot = path.resolve(String(raw.dataRoot || bridgeRoot));
  return {
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(bridgeRoot, 'chatgpt-plugin-bootstrap-state.json'),
    commanderDir: path.resolve(raw.repoRoot, 'tools', 'novelight-commander'),
    dataRoot: path.join(bridgeRoot, 'chatgpt-plugin'),
    browserProfileDir: path.join(sharedDataRoot, 'chatgpt-browser-profile')
  };
}

async function existingFile(file) {
  try { return (await fs.stat(file)).isFile(); }
  catch { return false; }
}

async function findChromeExecutable() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    process.env.NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE,
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
  ].filter(Boolean);
  for (const candidate of candidates) if (await existingFile(candidate)) return candidate;
  return null;
}

function token() {
  const value = String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
  if (!value) throw new Error('GitHub token missing.');
  return value;
}

async function api(tokenValue, method, apiPath, body) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenValue}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-NLO-ChatGPT-Plugin'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  let payload = text;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${typeof payload === 'object' ? payload?.message : payload}`);
  return payload;
}

async function readState(config) {
  try { return JSON.parse(await fs.readFile(config.statePath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return { last: 0, since: new Date(Date.now() - 60 * 60 * 1000).toISOString(), done: [] };
    throw error;
  }
}

async function saveState(config, state) {
  await fs.writeFile(config.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function parse(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(PREFIX)) return null;
  const request = JSON.parse(body.slice(PREFIX.length));
  if (!REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Invalid requestId.');
  if (request.operation !== 'register') throw new Error('Unsupported operation.');
  if (request.confirmation !== CONFIRMATION) throw new Error('CHAT_APPROVED required.');
  const keys = Object.keys(request).sort();
  const allowed = ['confirmation', 'description', 'operation', 'pluginName', 'requestId'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(allowed)) throw new Error('Request keys do not match fixed contract.');
  return request;
}

async function post(tokenValue, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request?.requestId || 'invalid'}\``,
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~text',
    redactSecrets(String(details)).slice(0, 6000),
    '~~~'
  ].join('\n');
  await api(tokenValue, 'POST', `/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments`, { body });
}

function restoreEnv(name, previous) {
  if (previous == null) delete process.env[name];
  else process.env[name] = previous;
}

async function handle(config, request) {
  const previousProfile = process.env.NOVELIGHT_CHATGPT_BROWSER_USER_DATA_DIR;
  const previousExecutable = process.env.NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE;
  process.env.NOVELIGHT_CHATGPT_BROWSER_USER_DATA_DIR = config.browserProfileDir;
  const chromeExecutable = await findChromeExecutable();
  if (chromeExecutable) process.env.NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE = chromeExecutable;
  try {
    const result = await bootstrapChatgptPlugin({
      pluginName: request.pluginName,
      description: request.description,
      commanderDir: config.commanderDir,
      dataRoot: config.dataRoot
    });
    return JSON.stringify({ ...result, browserProfile: 'nlo-managed', secretsExposed: false, credentialsRead: false, twoFactorBypassed: false }, null, 2);
  } finally {
    restoreEnv('NOVELIGHT_CHATGPT_BROWSER_USER_DATA_DIR', previousProfile);
    restoreEnv('NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE', previousExecutable);
  }
}

async function listCommentsSince(tokenValue, since) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const query = new URLSearchParams({ per_page: '100', since, page: String(page) });
    const batch = await api(tokenValue, 'GET', `/repos/${OWNER}/${REPO}/issues/${ISSUE}/comments?${query}`);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function poll(config, tokenValue, state) {
  const rows = await listCommentsSince(tokenValue, state.since);
  const pending = rows
    .filter(item => Number(item.id) > state.last)
    .sort((a, b) => a.id - b.id);
  const pluginComments = pending.filter(
    comment => comment.user?.login === OWNER && String(comment.body || '').startsWith(PREFIX)
  );
  const latestPluginCommentId = pluginComments.length
    ? Number(pluginComments.at(-1).id)
    : null;

  for (const comment of pending) {
    if (comment.user?.login === OWNER && String(comment.body || '').startsWith(PREFIX)) {
      let request;
      try {
        request = parse(comment);
        if (!state.done.includes(request.requestId)) {
          if (latestPluginCommentId !== null && Number(comment.id) !== latestPluginCommentId) {
            state.done.push(request.requestId);
            state.done = state.done.slice(-200);
          } else {
            const result = await handle(config, request);
            await post(tokenValue, request, 'success', result);
            state.done.push(request.requestId);
            state.done = state.done.slice(-200);
          }
        }
      } catch (error) {
        await post(tokenValue, request, 'failure', error instanceof Error ? error.message : String(error));
      }
    }
    state.last = Math.max(state.last, Number(comment.id || 0));
    state.since = comment.created_at || state.since;
    await saveState(config, state);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function mainChatgptPluginBootstrapBridge() {
  const config = await loadConfig();
  const tokenValue = token();
  const state = await readState(config);
  while (true) {
    try { await poll(config, tokenValue, state); }
    catch (error) { console.error('[NLO ChatGPT plugin bootstrap]', redactSecrets(String(error?.message || error))); }
    await sleep(config.pollSeconds * 1000);
  }
}
