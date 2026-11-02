// NLO Cloudflare integration: scoped, sanitized read-only operations and
// approval plans only. NEVER deploy, mutate, store credentials or auto-recover.
// The live independent Watchdog (Gate A) remains NO-GO.
const ACCOUNT_ID = '6831b18fe814232fa2dd4c470b95aa15';
const BASE = 'https://api.cloudflare.com/client/v4';
const PREFIX = 'novelight-ai-gatea-';
const WORKER_NAME = /^novelight-ai-gatea-[a-z0-9-]{1,60}$/u;
const NAMESPACE = /^[a-f0-9]{32}$/iu;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const QUERY = `query NloGateAMetrics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 100, filter: {
        scriptName: $scriptName, datetime_geq: $datetimeStart,
        datetime_leq: $datetimeEnd
      }) { sum { requests errors } }
    }
  }
}`;

export class NloCloudflareError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NloCloudflareError';
    this.code = code;
  }
}
function deny(code = 'nlo_cf_request_denied') {
  throw new NloCloudflareError(code);
}
function exact(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === allowed.length &&
    allowed.every((name) => Object.hasOwn(value, name));
}
function text(value, length = 100) {
  return typeof value === 'string' ?
    value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, length) : null;
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function worker(name) {
  if (!WORKER_NAME.test(name ?? '') || name.includes('--')) deny('nlo_cf_scope_denied');
  return name;
}
function ensureArgs(value, keys) {
  if (!exact(value, keys)) deny('nlo_cf_invalid_args');
}
function assertConfig(env) {
  if (env.NLO_CLOUDFLARE_READONLY_ENABLED !== 'true') deny('nlo_cf_not_enabled');
  if (env.NLO_CLOUDFLARE_ACCOUNT_ID !== ACCOUNT_ID) deny('nlo_cf_account_mismatch');
  const credential = String(env.NLO_CLOUDFLARE_READ_TOKEN ?? '');
  if (credential.length < 20 || credential.length > 4096 || /[\r\n]/u.test(credential)) {
    deny('nlo_cf_read_token_missing');
  }
  return credential;
}
function safeBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.success !== true) deny('nlo_cf_provider_denied');
  return value.result;
}
export function createNloCloudflareReadOnly({
  env = process.env, fetchImpl = fetch, now = Date.now
} = {}) {
  const token = assertConfig(env);
  if (typeof fetchImpl !== 'function' || typeof now !== 'function')
    deny('nlo_cf_invalid_runtime');
  async function request(method, relativePath, body) {
    // Call sites pass only static paths or names verified by worker() / NAMESPACE.
    const url = new URL(relativePath, BASE);
    if (url.origin !== 'https://api.cloudflare.com' ||
        !url.pathname.startsWith('/client/v4/') ||
        url.username || url.password || url.hash) deny();
    let response;
    try {
      response = await fetchImpl(url.href, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          ...(method === 'POST' ? {'Content-Type': 'application/json'} : {})
        },
        ...(method === 'POST' ? {body: JSON.stringify(body)} : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      // Never echo HTTP response/error strings: they can contain credentials.
      deny('nlo_cf_network_unavailable');
    }
    if (!response || !response.ok) {
      if (response?.status === 401 || response?.status === 403)
        deny('nlo_cf_insufficient_permission');
      if (response?.status === 429) deny('nlo_cf_rate_limited');
      deny('nlo_cf_api_unavailable');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      deny('nlo_cf_invalid_response');
    }
    // GraphQL is a read-only query transported over POST.
    if (method === 'POST') {
      if (!payload?.data || payload.errors?.length)
        deny('nlo_cf_metrics_unavailable');
      return payload.data;
    }
    return safeBody(payload);
  }
  const accountPath = '/client/v4/accounts/' + ACCOUNT_ID;
  const result = Object.freeze({
    async account() {
      const d = await request('GET', accountPath);
      if (d?.id !== ACCOUNT_ID) deny('nlo_cf_account_mismatch');
      return {accountId: ACCOUNT_ID, accountType: text(d.type, 30),
        plan: 'not_available_from_account_details_api', access: 'read_only'};
    },
    async workers() {
      const data = await request('GET', accountPath + '/workers/scripts');
      if (!Array.isArray(data)) deny('nlo_cf_invalid_response');
      const found = data.filter((x) => typeof x?.id === 'string' &&
        x.id.startsWith(PREFIX) && WORKER_NAME.test(x.id));
      return {accountId: ACCOUNT_ID, scripts: found.slice(0, 50).map((x) => ({
        name: text(x.id, 80), modifiedOn: iso(x.modified_on),
        createdOn: iso(x.created_on)
      })), truncated: found.length > 50,
      scope: PREFIX, access: 'read_only'};
    },
    async deployments(name) {
      const d = await request('GET', accountPath + '/workers/scripts/' +
        worker(name) + '/deployments');
      const entries = Array.isArray(d) ? d : Array.isArray(d?.deployments) ? d.deployments : null;
      if (!entries) deny('nlo_cf_invalid_response');
      return {worker: name, deployments: entries.slice(0, 15).map((x) => ({
        id: ID.test(x.id ?? '') ? x.id : null,
        createdOn: iso(x.created_on),
        source: text(x.source, 30)
      })), truncated: entries.length > 15, access: 'read_only'};
    },
    async namespaces() {
      const d = await request('GET', accountPath +
        '/workers/durable_objects/namespaces');
      if (!Array.isArray(d)) deny('nlo_cf_invalid_response');
      const scoped = d.filter((x) =>
        (typeof x?.name === 'string' && x.name.startsWith(PREFIX)) ||
        (typeof x?.script === 'string' && x.script.startsWith(PREFIX)));
      return {accountId: ACCOUNT_ID, namespaces: scoped.slice(0, 50).map((x) => ({
        id: NAMESPACE.test(x.id ?? '') ? x.id : null,
        name: text(x.name, 100), script: text(x.script, 100)
      })), truncated: scoped.length > 50, access: 'read_only'};
    },
    async objects(namespaceId) {
      if (!NAMESPACE.test(namespaceId ?? '')) deny('nlo_cf_scope_denied');
      const list = await result.namespaces();
      if (!list.namespaces.some((x) => x.id === namespaceId))
        deny('nlo_cf_namespace_not_owned_by_gatea');
      const d = await request('GET', accountPath +
        '/workers/durable_objects/namespaces/' + namespaceId + '/objects?limit=50');
      if (!Array.isArray(d)) deny('nlo_cf_invalid_response');
      return {namespaceId, countReturned: d.length,
        truncated: d.length >= 50, access: 'read_only',
        detail: 'No DO storage contents or object IDs are returned'};
    },
    async observability(name) {
      const d = await request('GET', accountPath + '/workers/scripts/' +
        worker(name) + '/script-settings');
      return {worker: name, logpush: d?.logpush === true,
        observabilityEnabled: d?.observability?.enabled === true,
        logsEnabled: d?.observability?.logs?.enabled === true,
        invocationLogsEnabled: d?.observability?.logs?.invocation_logs === true,
        tracesEnabled: d?.observability?.traces?.enabled === true,
        access: 'read_only', rawLogsReturned: false};
    },
    async metrics(name, minutes = 60) {
      worker(name);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440)
        deny('nlo_cf_invalid_window');
      const end = now();
      if (!Number.isSafeInteger(end)) deny('nlo_cf_invalid_clock');
      const d = await request('POST', '/client/v4/graphql', {
        query: QUERY,
        variables: {accountTag: ACCOUNT_ID, scriptName: name,
          datetimeStart: new Date(end - minutes * 60000).toISOString(),
          datetimeEnd: new Date(end).toISOString()}
      });
      const group = d?.viewer?.accounts;
      if (!Array.isArray(group) || group.length !== 1 ||
          !Array.isArray(group[0].workersInvocationsAdaptive))
        deny('nlo_cf_metrics_unavailable');
      let requests = 0, errors = 0;
      for (const item of group[0].workersInvocationsAdaptive) {
        const r = count(item?.sum?.requests), e = count(item?.sum?.errors);
        if (r === null || e === null || e > r) deny('nlo_cf_metrics_unavailable');
        requests += r; errors += e;
      }
      return {worker: name, windowMinutes: minutes, requests, errors,
        errorRate: requests ? errors / requests : null,
        sampled: true, incomplete: group[0].workersInvocationsAdaptive.length === 100,
        source: 'cloudflare_graphql_workers_invocations_adaptive',
        access: 'read_only', rawLogsReturned: false};
    },
    async watchdogStatus() {
      const [a, b] = await Promise.all([result.workers(), result.namespaces()]);
      const hasWorker = a.scripts.some((x) => x.name === PREFIX + 'watchdog');
      return {accountId: ACCOUNT_ID,
        watchdogScriptFound: hasWorker,
        namespacesFound: b.namespaces.length,
        runtimeHealthy: 'NOT_VERIFIED',
        runnerKillAuthority: 'NOT_VERIFIED',
        independentZeroCensus: 'NOT_VERIFIED',
        liveRecoveryAuthorized: false,
        gateA: 'NO_GO'};
    }
  });
  return result;
}

// A plan is NOT a permission grant. No Cloudflare API mutation exists here.
export function planNloCloudflareChange({action, workerName, ownerApproval} = {}) {
  if (!['create_worker', 'update_worker', 'delete_worker',
    'manage_durable_object', 'stop_watchdog'].includes(action) ||
    workerName !== PREFIX + 'watchdog' || ownerApproval !== false)
    deny('nlo_cf_plan_scope_denied');
  return {action, workerName,
    effect: 'none', apiMutationAttempted: false, liveAuthorization: false,
    requiredOwnerApproval: 'EXACT_ACTION_ACCOUNT_SHA_COST_ROLLBACK',
    tokenHandling: 'LOCAL_ONLY_NOT_IN_CHAT_OR_GITHUB',
    gateA: 'NO_GO'};
}

// Restricted GitHub Issue #797 bridge AND direct MCP dispatch.
export async function runNloCloudflareAction({
  action, args = {}, env = process.env, fetchImpl = fetch, now = Date.now
} = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) deny('nlo_cf_invalid_args');
  if (action === 'cloudflare_plan_change') {
    ensureArgs(args, ['action', 'workerName']);
    return planNloCloudflareChange({...args, ownerApproval: false});
  }
  const client = createNloCloudflareReadOnly({env, fetchImpl, now});
  if (action === 'cloudflare_account') {
    ensureArgs(args, []);
    return client.account();
  }
  if (action === 'cloudflare_workers') {
    ensureArgs(args, []);
    return client.workers();
  }
  if (action === 'cloudflare_durable_objects') {
    ensureArgs(args, []);
    return client.namespaces();
  }
  if (action === 'cloudflare_worker_deployments') {
    ensureArgs(args, ['workerName']);
    return client.deployments(worker(args.workerName));
  }
  if (action === 'cloudflare_worker_observability') {
    ensureArgs(args, ['workerName']);
    return client.observability(worker(args.workerName));
  }
  if (action === 'cloudflare_worker_metrics') {
    ensureArgs(args, ['workerName', 'minutes']);
    return client.metrics(worker(args.workerName), args.minutes);
  }
  if (action === 'cloudflare_do_object_count') {
    ensureArgs(args, ['namespaceId']);
    return client.objects(args.namespaceId);
  }
  if (action === 'cloudflare_watchdog_status') {
    ensureArgs(args, []);
    return client.watchdogStatus();
  }
  deny('nlo_cf_unknown_action');
}
