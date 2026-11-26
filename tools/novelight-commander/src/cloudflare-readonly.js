import { createHash } from 'node:crypto';

// NLO Cloudflare integration: scoped, sanitized read-only operations and
// approval plans only. NEVER deploy, mutate, store credentials or auto-recover.
// The live independent Watchdog (Gate A) remains NO-GO.
const ACCOUNT_ID = '6831b18fe814232fa2dd4c470b95aa15';
const WATCHDOG = 'novelight-ai-gatea-watchdog';
const WATCHDOG_NAMESPACE = '015ef5be967f4fbfbad31ab24a22bf26';
const WATCHDOG_CLASS = 'GateAWatchdogDurableObject';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
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
  // Hash Cloudflare's raw /content/v2 response locally. This is NOT a
  // reconstructible hash of the original Wrangler multipart build or A1 files.
  // Never serialize source bytes, response headers, or API errors to the Bridge.
  async function hashWorkerContent() {
    const url = new URL(accountPath + '/workers/scripts/' +
      WATCHDOG + '/content/v2', BASE);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/javascript'
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      deny('nlo_cf_network_unavailable');
    }
    if (!response?.ok || response.status !== 200) {
      if (response?.status === 401 || response?.status === 403)
        deny('nlo_cf_content_permission_denied');
      if (response?.status === 429) deny('nlo_cf_rate_limited');
      deny('nlo_cf_content_unavailable');
    }
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_SOURCE_BYTES)
      deny('nlo_cf_content_too_large');
    const type = response.headers?.get?.('content-type') ?? '';
    if (typeof type === 'string' && /application\/json/iu.test(type))
      deny('nlo_cf_content_unexpected_type');
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      if (typeof response.body?.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) ||
              bytes + value.byteLength > MAX_SOURCE_BYTES) {
            await reader.cancel();
            deny('nlo_cf_content_too_large');
          }
          bytes += value.byteLength;
          hash.update(value);
        }
      } else if (typeof response.arrayBuffer === 'function') {
        const data = await response.arrayBuffer();
        if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_SOURCE_BYTES)
          deny('nlo_cf_content_too_large');
        bytes = data.byteLength;
        hash.update(new Uint8Array(data));
      } else {
        deny('nlo_cf_content_unreadable');
      }
    } catch {
      deny('nlo_cf_content_read_failed');
    }
    if (bytes === 0) deny('nlo_cf_content_empty');
    return {sha256: hash.digest('hex'), bytes};
  }
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
    async watchdogProvenance(expectedContentSha256 = null) {
      // One exact Worker and namespace only, not a generic content download.
      if (expectedContentSha256 !== null &&
          !SHA256.test(expectedContentSha256))
        deny('nlo_cf_expected_hash_invalid');
      const list = await result.deployments(WATCHDOG);
      if (list.truncated || list.deployments.length < 1)
        deny('nlo_cf_deployment_not_unique');
      const sorted = [...list.deployments].sort((a, b) =>
        Date.parse(b.createdOn ?? '') - Date.parse(a.createdOn ?? ''));
      const active = sorted[0];
      if (!UUID.test(active?.id ?? '') || !active?.createdOn)
        deny('nlo_cf_deployment_invalid');
      const base = accountPath + '/workers/scripts/' + WATCHDOG;
      const deployment = await request('GET', base + '/deployments/' + active.id);
      if (deployment?.id !== active.id ||
          !Array.isArray(deployment.versions) ||
          deployment.versions.length !== 1 ||
          deployment.versions[0]?.percentage !== 100 ||
          !UUID.test(deployment.versions[0].version_id ?? ''))
        deny('nlo_cf_deployment_version_unverified');
      const versionId = deployment.versions[0].version_id;
      const [version, settings, namespaces] = await Promise.all([
        request('GET', base + '/versions/' + versionId),
        request('GET', base + '/settings'),
        result.namespaces()
      ]);
      if (version?.id !== versionId ||
          !Array.isArray(settings?.bindings) ||
          namespaces.truncated)
        deny('nlo_cf_version_settings_unverified');
      const bindingMatches = settings.bindings.filter((b) =>
        b?.name === 'GATEA_WATCHDOG' &&
        b?.type === 'durable_object_namespace' &&
        b?.class_name === WATCHDOG_CLASS &&
        (!b.script_name || b.script_name === WATCHDOG)
      );
      const exportInfo = version.resources?.script_runtime?.exports?.[WATCHDOG_CLASS];
      const namespaceMatches = namespaces.namespaces.filter((n) =>
        n.id === WATCHDOG_NAMESPACE &&
        n.script === WATCHDOG &&
        n.name === WATCHDOG + '_' + WATCHDOG_CLASS
      );
      const bindingVerified = bindingMatches.length === 1 &&
        settings.bindings.filter((b) => b?.name === 'GATEA_WATCHDOG').length === 1;
      const sqliteClassVerified =
        exportInfo?.type === 'durable-object' &&
        exportInfo.storage === 'sqlite' &&
        (!exportInfo.state || exportInfo.state === 'created');
      const namespaceVerified = namespaceMatches.length === 1;
      const content = await hashWorkerContent();
      const after = await result.deployments(WATCHDOG);
      if (after.truncated ||
          after.deployments.length !== list.deployments.length ||
          after.deployments[0]?.id !== list.deployments[0]?.id)
        deny('nlo_cf_deployment_changed_mid_read');
      const hashMatchesExpected = expectedContentSha256 === null
        ? null : content.sha256 === expectedContentSha256;
      return {
        worker: WATCHDOG, accountId: ACCOUNT_ID,
        deploymentId: active.id, versionId,
        contentSha256: content.sha256, contentBytes: content.bytes,
        contentRepresentation: 'CLOUDFLARE_CONTENT_V2_EXACT_RESPONSE_BYTES',
        hashMatchesExpected, expectedComparableSourceRequired: true,
        originalA1HashesDirectlyComparable: false,
        bindingVerified, sqliteClassVerified, namespaceVerified,
        rollbackCandidateVersionId: versionId,
        rollbackEligibility: 'NOT_VERIFIED_BY_READ_ONLY',
        recoveryAuthorized: false, liveRecoveryAuthorized: false,
        gateA: 'NO_GO', access: 'read_only',
        sourceReturned: false, secretsReturned: false
      };
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
  if (action === 'cloudflare_watchdog_provenance') {
    if (!exact(args, []) && !exact(args, ['expectedContentSha256']))
      deny('nlo_cf_invalid_args');
    return client.watchdogProvenance(args.expectedContentSha256 ?? null);
  }
  if (action === 'cloudflare_watchdog_status') {
    ensureArgs(args, []);
    return client.watchdogStatus();
  }
  deny('nlo_cf_unknown_action');
}
