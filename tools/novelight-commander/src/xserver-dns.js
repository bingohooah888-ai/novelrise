import { spawn } from 'node:child_process';

const XSERVER_API_BASE = 'https://api.xserver.ne.jp';
const NOVELIGHT_DOMAIN = 'novelight.jp';
const RESEND_INBOUND_MX = Object.freeze({
  type: 'MX',
  host: '@',
  content: 'inbound-smtp.ap-northeast-1.amazonaws.com',
  ttl: 3600,
  priority: 10
});

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function normalizeRecord(record) {
  const value = record && typeof record === 'object' ? record : {};
  const ttl = value.ttl === 'default' ? 3600 : Number(value.ttl);
  return {
    type: String(value.type || '').trim().toUpperCase(),
    host: String(value.name ?? value.host ?? '').trim(),
    content: String(value.value ?? value.content ?? '').trim(),
    ttl,
    priority: Number(value.priority)
  };
}

function assertTargetArgs(args, { apply }) {
  const allowed = apply
    ? ['approval', 'constraints', 'domain', 'record']
    : ['constraints', 'domain', 'record'];
  if (!exactKeys(args, allowed)) {
    throw new Error(
      apply
        ? 'xserver_dns_apply requires exactly approval, constraints, domain, and record.'
        : 'xserver_dns_preview requires exactly constraints, domain, and record.'
    );
  }

  if (String(args.domain || '').trim().toLowerCase() !== NOVELIGHT_DOMAIN) {
    throw new Error('XServer DNS actions are restricted to novelight.jp.');
  }

  if (
    !exactKeys(args.constraints, [
      'add_only',
      'do_not_delete_existing',
      'do_not_modify_existing'
    ]) ||
    args.constraints.add_only !== true ||
    args.constraints.do_not_delete_existing !== true ||
    args.constraints.do_not_modify_existing !== true
  ) {
    throw new Error(
      'XServer DNS actions require add-only, no-modify, no-delete constraints.'
    );
  }

  const record = normalizeRecord(args.record);
  if (
    record.type !== RESEND_INBOUND_MX.type ||
    record.host !== RESEND_INBOUND_MX.host ||
    record.content !== RESEND_INBOUND_MX.content ||
    record.ttl !== RESEND_INBOUND_MX.ttl ||
    record.priority !== RESEND_INBOUND_MX.priority
  ) {
    throw new Error(
      'XServer DNS actions are restricted to the approved NOVELIGHT Resend inbound MX record.'
    );
  }

  if (apply && String(args.approval || '') !== 'production_approved') {
    throw new Error('xserver_dns_apply requires production_approved approval.');
  }

  return record;
}

function resolveApiKey(env) {
  return String(
    env.NOVELIGHT_XSERVER_API_KEY || env.XSERVER_API_KEY || ''
  ).trim();
}

function redactCliText(text) {
  return String(text || '')
    .replace(/\bxs_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .slice(0, 1200);
}

function defaultCliRunner(args) {
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npx';
  const cliArgs = isWindows
    ? ['/d', '/s', '/c', 'npx', '--yes', 'xserver-cli', ...args]
    : ['--yes', 'xserver-cli', ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, cliArgs, {
      shell: false,
      windowsHide: true,
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('XServer CLI timed out.'));
    }, 120000);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
  });
}

function defaultInteractiveAuthLauncher() {
  if (process.platform !== 'win32') {
    throw new Error('Interactive XServer CLI login is only supported on Windows NLO hosts.');
  }

  return new Promise((resolve, reject) => {
    const executable = process.env.ComSpec || 'cmd.exe';
    const child = spawn(
      executable,
      ['/d', '/c', 'npx', '--yes', 'xserver-cli', 'auth', 'login'],
      {
        shell: false,
        windowsHide: false,
        detached: true,
        stdio: 'ignore',
        env: process.env
      }
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMissingCliProfileError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return (
    message.includes('認証設定が見つかりません') ||
    message.includes('xserver auth login')
  );
}

async function waitForCliProfile(cliRunner, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    const result = await cliRunner(['--format', 'json', 'auth', 'status']).catch(
      error => ({
        code: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error)
      })
    );
    if (result.code === 0) return;
    lastError = redactCliText(result.stderr || result.stdout || 'not authenticated');
    await delay(2500);
  }

  throw new Error(
    'XServer CLI login did not complete within 5 minutes. Last status: ' +
      lastError
  );
}

async function xserverRequest({ fetchImpl, apiKey, method, path, body }) {
  const response = await fetchImpl(XSERVER_API_BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json',
      ...(body == null ? {} : { 'Content-Type': 'application/json' })
    },
    signal: AbortSignal.timeout(15000),
    body: body == null ? undefined : JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerCode = String(payload?.code || payload?.error || '').trim();
    const providerMessage = String(payload?.message || '').trim();
    const detail = [providerCode, providerMessage].filter(Boolean).join(': ');
    throw new Error(
      'XServer API request failed: HTTP ' +
        response.status +
        (detail ? ' (' + detail.slice(0, 300) + ')' : '')
    );
  }
  return payload;
}

function normalizeDnsRows(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.records)
      ? payload.records
      : Array.isArray(payload?.dns_records)
        ? payload.dns_records
        : Array.isArray(payload?.data?.records)
          ? payload.data.records
          : [];
  return rows.map(row => ({
    id: Number(row?.id ?? row?.dns_id),
    type: String(row?.type || '').trim().toUpperCase(),
    host: String(row?.host || '').trim(),
    content: String(row?.content || row?.value || '').trim(),
    ttl: Number(row?.ttl),
    priority: Number(row?.priority ?? 0)
  }));
}

function isTargetRecord(row) {
  return (
    row.type === RESEND_INBOUND_MX.type &&
    row.host === RESEND_INBOUND_MX.host &&
    row.content === RESEND_INBOUND_MX.content &&
    row.priority === RESEND_INBOUND_MX.priority
  );
}

function apexMxRows(rows) {
  return rows.filter(row => row.type === 'MX' && row.host === '@');
}

function formatMxRows(rows) {
  if (!rows.length) return 'none';
  return rows
    .map(
      row =>
        row.content +
        ' priority=' +
        row.priority +
        ' ttl=' +
        (Number.isFinite(row.ttl) ? row.ttl : 'unknown')
    )
    .join(' | ');
}

function parseCliJson(stdout) {
  const text = String(stdout || '').trim().replace(/^\uFEFF/u, '');
  if (!text) throw new Error('XServer CLI returned no JSON output.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('XServer CLI returned invalid JSON output.');
  }
}

async function runCliJson(cliRunner, args) {
  const result = await cliRunner(args);
  if (result.code !== 0) {
    throw new Error(
      'XServer CLI authentication is unavailable: ' +
        redactCliText(result.stderr || result.stdout || 'command failed')
    );
  }
  return parseCliJson(result.stdout);
}

async function listDns({
  env,
  fetchImpl,
  cliRunner,
  interactiveAuthLauncher,
  platform
}) {
  const apiKey = resolveApiKey(env);
  if (apiKey) {
    const payload = await xserverRequest({
      fetchImpl,
      apiKey,
      method: 'GET',
      path: '/v1/domain/' + encodeURIComponent(NOVELIGHT_DOMAIN) + '/dns'
    });
    return { rows: normalizeDnsRows(payload), credentialSource: 'environment' };
  }

  const args = [
    '--format',
    'json',
    'domain',
    'dns',
    'list',
    NOVELIGHT_DOMAIN
  ];

  let payload;
  try {
    payload = await runCliJson(cliRunner, args);
  } catch (error) {
    if (platform !== 'win32' || !isMissingCliProfileError(error)) throw error;
    await interactiveAuthLauncher();
    await waitForCliProfile(cliRunner);
    payload = await runCliJson(cliRunner, args);
  }

  return { rows: normalizeDnsRows(payload), credentialSource: 'cli_profile' };
}

async function addTargetDns({ env, fetchImpl, cliRunner }) {
  const apiKey = resolveApiKey(env);
  if (apiKey) {
    await xserverRequest({
      fetchImpl,
      apiKey,
      method: 'POST',
      path: '/v1/domain/' + encodeURIComponent(NOVELIGHT_DOMAIN) + '/dns',
      body: { ...RESEND_INBOUND_MX }
    });
    return 'environment';
  }

  await runCliJson(cliRunner, [
    '--format',
    'json',
    '--yes',
    'domain',
    'dns',
    'add',
    NOVELIGHT_DOMAIN,
    '--host',
    RESEND_INBOUND_MX.host,
    '--type',
    RESEND_INBOUND_MX.type,
    '--content',
    RESEND_INBOUND_MX.content,
    '--ttl',
    String(RESEND_INBOUND_MX.ttl),
    '--priority',
    String(RESEND_INBOUND_MX.priority)
  ]);
  return 'cli_profile';
}

async function preview(request, dependencies) {
  assertTargetArgs(request.args, { apply: false });
  const listed = await listDns(dependencies);
  const mx = apexMxRows(listed.rows);
  const targetPresent = mx.some(isTargetRecord);
  const conflicting = mx.filter(row => !isTargetRecord(row));

  return [
    'xserver_authenticated: true',
    'credential_source: ' + listed.credentialSource,
    'domain: ' + NOVELIGHT_DOMAIN,
    'target_record_present: ' + targetPresent,
    'existing_apex_mx_count: ' + mx.length,
    'existing_apex_mx: ' + formatMxRows(mx),
    'conflicting_apex_mx_count: ' + conflicting.length,
    'would_add: ' + (!targetPresent && conflicting.length === 0),
    'mutation_performed: false',
    'secret_value_exposed: false'
  ].join('\n');
}

async function apply(request, dependencies) {
  assertTargetArgs(request.args, { apply: true });
  const before = await listDns(dependencies);
  const beforeMx = apexMxRows(before.rows);

  if (beforeMx.some(isTargetRecord)) {
    return [
      'domain: ' + NOVELIGHT_DOMAIN,
      'credential_source: ' + before.credentialSource,
      'target_record_present: true',
      'already_present: true',
      'record_added: false',
      'existing_apex_mx: ' + formatMxRows(beforeMx),
      'verified_after_write: true',
      'secret_value_exposed: false'
    ].join('\n');
  }

  const conflicts = beforeMx.filter(row => !isTargetRecord(row));
  if (conflicts.length) {
    throw new Error(
      'Existing apex MX records would make add-only mail routing ambiguous. No DNS mutation was performed. Existing MX: ' +
        formatMxRows(conflicts)
    );
  }

  const credentialSource = await addTargetDns(dependencies);
  const after = await listDns(dependencies);
  const afterMx = apexMxRows(after.rows);
  const verified = afterMx.some(isTargetRecord);
  if (!verified) {
    throw new Error(
      'XServer accepted the DNS write but the approved MX record was not visible on verification.'
    );
  }

  return [
    'domain: ' + NOVELIGHT_DOMAIN,
    'credential_source: ' + credentialSource,
    'target_record_present: true',
    'already_present: false',
    'record_added: true',
    'existing_apex_mx: ' + formatMxRows(afterMx),
    'verified_after_write: true',
    'secret_value_exposed: false'
  ].join('\n');
}

export function createXserverDnsActions({
  env = process.env,
  fetchImpl = globalThis.fetch,
  cliRunner = defaultCliRunner,
  interactiveAuthLauncher = defaultInteractiveAuthLauncher,
  platform = process.platform
} = {}) {
  const dependencies = {
    env,
    fetchImpl,
    cliRunner,
    interactiveAuthLauncher,
    platform
  };
  return {
    preview: request => preview(request, dependencies),
    apply: request => apply(request, dependencies)
  };
}

export async function actionXserverDnsPreview(request) {
  return createXserverDnsActions().preview(request);
}

export async function actionXserverDnsApply(request) {
  return createXserverDnsActions().apply(request);
}
