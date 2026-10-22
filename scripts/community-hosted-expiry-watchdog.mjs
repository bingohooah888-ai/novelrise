// Independent cleanup only. Never provisions Staging or grants execution.
// A separately protected runner must sign an intent BEFORE creating a branch.
import { createHmac, timingSafeEqual } from 'node:crypto';

const REPO = 'bingohooah888-ai/novelrise';
const PARENT = 'fiepaguycecrredwrcwx';
const SHARED = 'wmlzjgvxgoyrovdhbqbg';
const MARKER = 'NOVELIGHT_COMMUNITY_WATCHDOG_V1 ';
const API = 'https://api.supabase.com/v1';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const REF = /^[a-z0-9]{20}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function deny() {
  throw new Error('COMMUNITY_WATCHDOG_DENIED');
}
function instant(value) {
  if (typeof value !== 'string') deny();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) deny();
  return date.getTime();
}
function checkedIntent(value) {
  if (value?.version !== 1 || value.repository !== REPO ||
      value.scope !== 'community-phase1-hosted-authenticated-write' ||
      !ID.test(value.runId ?? '') ||
      !ID.test(value.requestCommentId ?? '') ||
      !SHA.test(value.mainSha ?? '') ||
      !SHA.test(value.candidateSha ?? '') ||
      value.mainSha === value.candidateSha ||
      !Number.isSafeInteger(value.graceMinutes) ||
      value.graceMinutes < 1 || value.graceMinutes > 15) deny();
  const start = instant(value.preparedAt);
  const end = instant(value.expiresAt);
  if (end <= start || end - start > 120 * 60000) deny();
  return { ...value, start, end };
}
function hmac(body, secret) {
  if (typeof secret !== 'string' || secret.length < 32) deny();
  return createHmac('sha256', secret).update(body).digest('hex');
}
// Signing and publishing this record must happen only from a protected,
// independently reviewed OWNER workflow. This function grants no permission.
export function signCommunityWatchIntent(intent, secret) {
  checkedIntent(intent);
  const encoded = Buffer.from(JSON.stringify(intent)).toString('base64url');
  return MARKER + encoded + '.' + hmac(encoded, secret);
}
export function verifyCommunityWatchIntent(body, secret) {
  if (typeof body !== 'string' || !body.startsWith(MARKER)) return null;
  const token = /^([A-Za-z0-9_-]{20,2500})\.([a-f0-9]{64})$/u.exec(
    body.slice(MARKER.length)
  );
  if (!token) return null;
  const expected = Buffer.from(hmac(token[1], secret), 'hex');
  const actual = Buffer.from(token[2], 'hex');
  if (!timingSafeEqual(expected, actual)) return null;
  try {
    return checkedIntent(
      JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8'))
    );
  } catch {
    return null;
  }
}
export function inspectCommunityWatchBranches({ branches, intents, now }) {
  if (!Array.isArray(branches) || !Array.isArray(intents) ||
      branches.length > 200 || intents.length > 3000 ||
      !Number.isSafeInteger(now)) deny();
  const runs = new Map();
  for (const value of intents) {
    const item = checkedIntent(value);
    if (runs.has(item.runId)) deny();
    runs.set(item.runId, item);
  }
  const expired = [];
  const unregistered = [];
  for (const branch of branches) {
    const id = /^community-hosted-([1-9][0-9]*)$/u.exec(
      branch?.name ?? ''
    );
    if (!id) continue;
    const intent = runs.get(id[1]);
    if (!intent) {
      unregistered.push(branch.name);
      continue;
    }
    if (!UUID.test(branch.id ?? '') || !REF.test(branch.project_ref ?? '') ||
        [PARENT, SHARED].includes(branch.project_ref) ||
        branch.parent_project_ref !== PARENT ||
        branch.is_default !== false || branch.persistent !== false ||
        branch.with_data !== false) deny();
    const created = instant(branch.created_at);
    if (created < intent.start - 60000 || created > intent.end + 60000) {
      deny();
    }
    if (now >= intent.end + intent.graceMinutes * 60000) {
      expired.push({
        id: branch.id,
        ref: branch.project_ref,
        name: branch.name,
        runId: intent.runId
      });
    }
  }
  return { expired, unregistered };
}
async function getJson(url, token, fetchImpl, method = 'GET') {
  let result;
  try {
    result = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    deny();
  }
  if (result?.status !== 200) deny();
  if (method === 'DELETE') return null;
  try {
    return await result.json();
  } catch {
    deny();
  }
}
async function issueComments(token, fetchImpl) {
  const values = [];
  for (let page = 1; page <= 30; page += 1) {
    const items = await getJson(
      'https://api.github.com/repos/' + REPO +
        '/issues/188/comments?per_page=100&page=' + page,
      token,
      fetchImpl
    );
    if (!Array.isArray(items) || items.length > 100) deny();
    values.push(...items);
    if (items.length < 100) return values;
  }
  deny();
}
async function inventory(token, fetchImpl) {
  const rows = await getJson(
    API + '/projects/' + PARENT + '/branches',
    token,
    fetchImpl
  );
  if (!Array.isArray(rows)) deny();
  return rows;
}
export async function runCommunityWatchdog({
  githubToken,
  supabaseToken,
  signingKey,
  now = Date.now(),
  fetchImpl = fetch
}) {
  if ([githubToken, supabaseToken, signingKey].some(
    (value) => typeof value !== 'string' || value.length < 32
  )) deny();
  const comments = await issueComments(githubToken, fetchImpl);
  const intents = comments.map((item) =>
    verifyCommunityWatchIntent(item?.body, signingKey)
  ).filter(Boolean);
  const items = inspectCommunityWatchBranches({
    branches: await inventory(supabaseToken, fetchImpl),
    intents,
    now
  });
  const disposed = [];
  for (const item of items.expired) {
    const fresh = await inventory(supabaseToken, fetchImpl);
    const exact = fresh.filter((row) =>
      row.id === item.id &&
      row.project_ref === item.ref &&
      row.name === item.name
    );
    if (exact.length !== 1) deny();
    const recheck = inspectCommunityWatchBranches({
      branches: exact,
      intents,
      now
    });
    if (recheck.expired.length !== 1) deny();
    await getJson(
      API + '/branches/' + item.id + '?force=true',
      supabaseToken,
      fetchImpl,
      'DELETE'
    );
    if ((await inventory(supabaseToken, fetchImpl)).some(
      (row) => row.id === item.id
    )) deny();
    disposed.push(item.runId);
  }
  return {
    status: 'COMMUNITY_WATCHDOG_CLEANUP_ONLY',
    disposedRunIds: disposed,
    unregisteredCount: items.unregistered.length
  };
}
if (process.argv[2] === 'run') {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' ||
        process.env.GITHUB_REF !== 'refs/heads/main' ||
        process.env.GITHUB_REPOSITORY !== REPO ||
        process.env.GITHUB_WORKFLOW !==
          'Community Hosted Independent Expiry Watchdog') deny();
    const result = await runCommunityWatchdog({
      githubToken: process.env.GH_TOKEN,
      supabaseToken: process.env.NOVELIGHT_WATCHDOG_SUPABASE_TOKEN,
      signingKey: process.env.NOVELIGHT_WATCHDOG_SIGNING_KEY
    });
    console.log(JSON.stringify(result));
    if (result.unregisteredCount) process.exitCode = 1;
  } catch {
    console.error('COMMUNITY_WATCHDOG_DENIED');
    process.exitCode = 1;
  }
}
