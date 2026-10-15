// Stage 05: manually triggered, read-only Management API compatibility probe.
// This file has no database write path, approval adoption, or registration release.
// Never log the token, raw SQL response body, or sensitive user data.
import { validateReadOnlyRows } from './november-contest-registration-release.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'fiepaguycecrredwrcwx';
// Keep this SQL aligned with the precheck in november-contest-registration-release.mjs.
const BEFORE_SQL = `select c.status, c.public_visible, c.terms_version, c.terms_url,
  (select count(*)::integer from public.novelight_contest_entries e
    where e.contest_id=c.id) as entry_count
from public.novelight_contests c
where c.contest_key='novelight-november-2026';`;

function blocked(message) {
  throw new Error('STEP05_READONLY_PREFLIGHT_BLOCKED: ' + message);
}

export async function runManagementReadOnlyProbe({
  env = process.env,
  request = fetch,
  report = console.log
} = {}) {
  // A human-triggered workflow on main is required. No automatic triggers.
  if (env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_REPOSITORY !== REPO ||
      env.NOVELIGHT_CONTEST_READONLY_PREFLIGHT !== 'MANUAL_READONLY_ONLY') {
    blocked('manual GitHub main-only execution identity mismatch');
  }
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== 'string' || !token.trim()) {
    blocked('Management API secret unavailable');
  }

  const url = 'https://api.supabase.com/v1/projects/' + PROJECT +
    '/database/query/read-only';
  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: BEFORE_SQL }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  });
  if (response.status !== 201) {
    // HTTP status only, not server body or Authorization header.
    blocked('read-only Management API HTTP ' + response.status);
  }
  let rows;
  try {
    rows = await response.json();
  } catch {
    blocked('read-only response is not JSON');
  }
  if (!Array.isArray(rows)) {
    blocked('read-only response not Array<Row> (object or other shape)');
  }
  // Reuse the very same exact-state validator used by the approved release.
  validateReadOnlyRows(rows, 'before', 0);
  report('STEP05_READONLY_PREFLIGHT_OK: HTTP 201, Array<Row>, draft/private, ' +
    'terms unset, entries zero; no Production mutation.');
  return true;
}

if (process.argv[1]?.endsWith('/november-contest-management-readonly-preflight.mjs')) {
  runManagementReadOnlyProbe().catch((err) => {
    console.error(String(err));
    process.exitCode = 1;
  });
}
