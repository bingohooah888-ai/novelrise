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
  const key = String(
    env.NOVELIGHT_XSERVER_API_KEY || env.XSERVER_API_KEY || ''
  ).trim();
  if (!key) {
    throw new Error(
      'XServer API key is not configured. Set NOVELIGHT_XSERVER_API_KEY with DNS read/write permission for novelight.jp.'
    );
  }
  return key;
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
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  return rows.map(row => ({
    id: Number(row?.id),
    type: String(row?.type || '').trim().toUpperCase(),
    host: String(row?.host || '').trim(),
    content: String(row?.content || '').trim(),
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

async function listDns({ fetchImpl, apiKey }) {
  const payload = await xserverRequest({
    fetchImpl,
    apiKey,
    method: 'GET',
    path: '/v1/domain/' + encodeURIComponent(NOVELIGHT_DOMAIN) + '/dns'
  });
  return normalizeDnsRows(payload);
}

async function preview(request, { env, fetchImpl }) {
  assertTargetArgs(request.args, { apply: false });
  const apiKey = resolveApiKey(env);
  const rows = await listDns({ fetchImpl, apiKey });
  const mx = apexMxRows(rows);
  const targetPresent = mx.some(isTargetRecord);
  const conflicting = mx.filter(row => !isTargetRecord(row));

  return [
    'xserver_authenticated: true',
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

async function apply(request, { env, fetchImpl }) {
  assertTargetArgs(request.args, { apply: true });
  const apiKey = resolveApiKey(env);
  const before = await listDns({ fetchImpl, apiKey });
  const beforeMx = apexMxRows(before);

  if (beforeMx.some(isTargetRecord)) {
    return [
      'domain: ' + NOVELIGHT_DOMAIN,
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

  await xserverRequest({
    fetchImpl,
    apiKey,
    method: 'POST',
    path: '/v1/domain/' + encodeURIComponent(NOVELIGHT_DOMAIN) + '/dns',
    body: { ...RESEND_INBOUND_MX }
  });

  const after = await listDns({ fetchImpl, apiKey });
  const afterMx = apexMxRows(after);
  const verified = afterMx.some(isTargetRecord);
  if (!verified) {
    throw new Error(
      'XServer accepted the DNS write but the approved MX record was not visible on verification.'
    );
  }

  return [
    'domain: ' + NOVELIGHT_DOMAIN,
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
  fetchImpl = globalThis.fetch
} = {}) {
  return {
    preview: request => preview(request, { env, fetchImpl }),
    apply: request => apply(request, { env, fetchImpl })
  };
}

export async function actionXserverDnsPreview(request) {
  return createXserverDnsActions().preview(request);
}

export async function actionXserverDnsApply(request) {
  return createXserverDnsActions().apply(request);
}
