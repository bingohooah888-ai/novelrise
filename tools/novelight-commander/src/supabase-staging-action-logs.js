// NLO Supabase Management API: offline-first, Staging-branch-scoped action
// history and sanitized migration error signals. NEVER connect to a DB.
// No raw logs, access tokens or third-party error bodies cross MCP/Issue Bridge.
// Actual Management API reads require separate approval and local opt-in.
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
const BRANCH_ID = '4ea5dd93-4032-4d53-8b4f-46bef5cb50d2';
const BASE_URL = 'https://api.supabase.com';
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/u;
const VERSION = /^20[0-9]{12}$/u;
const KNOWN_STEPS = new Set([
  'clone',
  'pull',
  'health',
  'configure',
  'migrate',
  'seed',
  'deploy'
]);
const KNOWN_STATUS = new Set([
  'CREATED',
  'QUEUED',
  'RUNNING',
  'IN_PROGRESS',
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'EXITED',
  'FAILED',
  'FAILURE',
  'DEAD',
  'CANCELLED',
  'SKIPPED'
]);

export class NloSupabaseStagingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NloSupabaseStagingError';
    this.code = code;
  }
}
function deny(code = 'nlo_sb_denied') {
  throw new NloSupabaseStagingError(code);
}
function exactObject(input, fields) {
  return (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === fields.length &&
    fields.every((key) => Object.hasOwn(input, key))
  );
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 48) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function assertRuntime(env, fetchImpl) {
  if (env.NLO_SUPABASE_STAGING_READONLY_ENABLED !== 'true') {
    deny('nlo_sb_not_enabled');
  }
  if (env.NLO_SUPABASE_STAGING_PROJECT_REF !== STAGING_REF) {
    deny('nlo_sb_staging_ref_mismatch');
  }
  const token = env.SUPABASE_ACCESS_TOKEN;
  // A server-side Management API access token is NOT a Supabase anon,
  // publishable, service_role, secret, GitHub or OpenAI API credential.
  // Reuse only an existing local token; never create, print or save one.
  if (
    typeof token !== 'string' ||
    token.length < 20 ||
    token.length > 4096 ||
    /[\r\n\s]/u.test(token) ||
    /^(?:eyJ[^.]*\.eyJ|sb_secret_|sb_publishable_|sk_|sk-|ghp_|gho_|github_pat_)/iu.test(
      token
    )
  ) {
    deny('nlo_sb_management_token_unavailable');
  }
  if (typeof fetchImpl !== 'function') deny('nlo_sb_invalid_runtime');
  return token;
}
async function boundedBody(response, maxBytes) {
  const sizeHeader = response?.headers?.get?.('content-length');
  if (
    sizeHeader != null &&
    (!/^\d+$/u.test(sizeHeader) || Number(sizeHeader) > maxBytes)
  )
    deny('nlo_sb_response_too_large');
  let bytes;
  try {
    if (response?.body?.getReader) {
      const reader = response.body.getReader();
      const parts = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) deny('nlo_sb_response_too_large');
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      bytes = Buffer.concat(
        parts.map((x) => Buffer.from(x)),
        total
      ).toString('utf8');
    } else {
      bytes = await response.text();
      if (Buffer.byteLength(bytes, 'utf8') > maxBytes)
        deny('nlo_sb_response_too_large');
    }
  } catch (error) {
    if (error instanceof NloSupabaseStagingError) throw error;
    deny('nlo_sb_invalid_response');
  }
  return bytes;
}
function parseRuns(payload) {
  // Official Management API /actions returns a JSON array, not arbitrary
  // result objects. A shape change fails closed until re-reviewed.
  if (!Array.isArray(payload) || payload.length > 25)
    deny('nlo_sb_unexpected_action_shape');
  const seen = new Set();
  const filtered = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      deny('nlo_sb_unexpected_action_shape');
    }
    // An action listed for a different branch may be returned when the API
    // is scoped to its parent. Never disclose or follow that run.
    if (item.branch_id !== BRANCH_ID) continue;
    if (
      !RUN_ID.test(item.id ?? '') ||
      seen.has(item.id) ||
      !Array.isArray(item.run_steps) ||
      item.run_steps.length > 32
    ) {
      deny('nlo_sb_unexpected_action_shape');
    }
    seen.add(item.id);
    const steps = item.run_steps.map((s) => {
      if (!s || !KNOWN_STEPS.has(s.name) || !KNOWN_STATUS.has(s.status))
        deny('nlo_sb_unexpected_action_shape');
      return {
        name: s.name,
        status: s.status,
        updatedAt: iso(s.updated_at)
      };
    });
    filtered.push({
      runId: item.id,
      branchRef: STAGING_REF,
      createdAt: iso(item.created_at),
      updatedAt: iso(item.updated_at),
      failed: steps.some((s) =>
        ['FAILED', 'FAILURE', 'DEAD'].includes(s.status)
      ),
      steps
    });
  }
  return filtered.sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  );
}
function sanitizeLog(text) {
  // Error logs are UNTRUSTED. Never echo line text, SQL, user IDs, emails,
  // URLs, headers, secrets, access tokens, queries, or raw response JSON.
  // Return only fixed categories and non-sensitive SQLSTATE/version tokens.
  const lines = text.split(/\r?\n/u);
  const categories = new Set();
  const versions = new Set();
  const sqlstates = new Set();
  const ERROR_LINE = /\b(error|failed|failure|fatal|exception|sqlstate)\b/iu;
  for (const line of lines.slice(0, 1500)) {
    if (!ERROR_LINE.test(line)) continue;
    if (
      /remote migration versions not found in local migrations directory/iu.test(
        line
      )
    )
      categories.add('migration_history_divergence');
    if (/permission denied|insufficient privilege|not authorized/iu.test(line))
      categories.add('permission_denied');
    if (/relation .* already exists|duplicate (?:relation|table)/iu.test(line))
      categories.add('duplicate_relation');
    if (/syntax error at or near/iu.test(line))
      categories.add('sql_syntax_error');
    if (/failed.*migrat|migrat.*failed|error.*migrat/iu.test(line))
      categories.add('migration_step_failed');
    if (/connection refused|connect.*timeout|network.*timeout/iu.test(line))
      categories.add('connection_error');
    const match = line.match(/SQLSTATE[\s:=()-]*([0-9A-Z]{5})(?![A-Z0-9])/iu);
    if (match) sqlstates.add(match[1].toUpperCase());
    if (/migrat|version/iu.test(line)) {
      const matches = line.match(/(?<![0-9])20[0-9]{12}(?![0-9])/gu) ?? [];
      for (const version of matches) {
        if (VERSION.test(version) && versions.size < 10) versions.add(version);
      }
    }
    if (!categories.size) categories.add('unclassified_error');
  }
  return {
    linesInspected: Math.min(lines.length, 1500),
    truncated: lines.length > 1500,
    categories: [...categories].sort(),
    migrationVersions: [...versions].sort(),
    sqlstates: [...sqlstates].sort(),
    rawLogsReturned: false
  };
}
export function createNloSupabaseStagingReadOnly({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const token = assertRuntime(env, fetchImpl);
  async function get(relative, maxBytes = 131072) {
    // URLs are internally assembled only from fixed ref + validated run_id.
    const url = new URL(relative, BASE_URL);
    if (
      url.origin !== BASE_URL ||
      !url.pathname.startsWith('/v1/projects/' + STAGING_REF + '/actions') ||
      url.pathname.includes(PRODUCTION_REF) ||
      url.username ||
      url.password ||
      url.hash
    )
      deny('nlo_sb_production_scope_denied');
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json, text/plain'
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      deny('nlo_sb_network_unavailable');
    }
    if (!response?.ok) {
      if ([401, 403].includes(response?.status))
        deny('nlo_sb_insufficient_management_permission');
      if (response?.status === 429) deny('nlo_sb_rate_limited');
      deny('nlo_sb_management_api_unavailable');
    }
    return boundedBody(response, maxBytes);
  }
  async function list() {
    const raw = await get(
      '/v1/projects/' + STAGING_REF + '/actions?offset=0&limit=25'
    );
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      deny('nlo_sb_unexpected_action_shape');
    }
    const runs = parseRuns(parsed);
    return {
      projectRef: STAGING_REF,
      expectedBranchId: BRANCH_ID,
      access: 'read_only',
      returned: runs.length,
      runs,
      rawLogsReturned: false
    };
  }
  async function logs(runId) {
    if (!RUN_ID.test(runId ?? '')) deny('nlo_sb_invalid_run_id');
    // Never permit an arbitrary run ID to bypass staging membership. This
    // creates one GET for scoped list + one GET for the selected log.
    const info = await list();
    const run = info.runs.find((x) => x.runId === runId);
    if (!run) deny('nlo_sb_run_not_in_staging');
    const raw = await get(
      '/v1/projects/' +
        STAGING_REF +
        '/actions/' +
        encodeURIComponent(runId) +
        '/logs',
      131072
    );
    return {
      projectRef: STAGING_REF,
      runId,
      branchId: BRANCH_ID,
      actionFailed: run.failed,
      ...sanitizeLog(raw),
      access: 'read_only'
    };
  }
  return Object.freeze({ list, logs });
}
export async function runNloSupabaseStagingAction({
  action,
  args = {},
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const operations = {
    supabase_staging_actions: [],
    supabase_staging_action_logs: ['runId']
  };
  if (!Object.hasOwn(operations, action)) deny('nlo_sb_action_denied');
  const fields = operations[action];
  if (!exactObject(args, fields)) deny('nlo_sb_invalid_args');
  if (fields.length && !RUN_ID.test(args.runId ?? ''))
    deny('nlo_sb_invalid_run_id');
  const client = createNloSupabaseStagingReadOnly({ env, fetchImpl });
  return action === 'supabase_staging_actions'
    ? client.list()
    : client.logs(args.runId);
}
