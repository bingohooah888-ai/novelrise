// Step 05: owner-only compatibility check of the Management API query route.
// This probe executes ONE fixed SELECT with read_only:true. It NEVER executes
// SQL writes, opens registration, reads prize/bank data, or logs response rows.
import { readFile } from 'node:fs/promises';
import { validateReadOnlyRows } from './november-contest-registration-release.mjs';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'bingohooah888-ai/novelrise';
const PROJECT = 'fiepaguycecrredwrcwx';
const COMMAND = 'NOVELIGHT_CONTEST_QUERY_ENDPOINT_SELECT_PREFLIGHT_RUN';
const SQL = `select c.status, c.public_visible, c.terms_version, c.terms_url,
  (select count(*)::integer from public.novelight_contest_entries e
    where e.contest_id=c.id) as entry_count
from public.novelight_contests c
where c.contest_key='novelight-november-2026';`;

function block(reason) {
  throw new Error('STEP05_QUERY_ROUTE_SELECT_BLOCKED: ' + reason);
}

export async function runQueryRouteSelectPreflight({
  env = process.env,
  request = fetch,
  readEvent = async (file) => JSON.parse(await readFile(file, 'utf8')),
  report = console.log
} = {}) {
  if (env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_EVENT_NAME !== 'issue_comment' ||
      env.GITHUB_ACTOR !== OWNER ||
      env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_REPOSITORY !== REPOSITORY ||
      env.NOVELIGHT_CONTEST_QUERY_ROUTE_PREFLIGHT !== 'FIXED_SELECT_READ_ONLY') {
    block('trusted owner/main-only Actions context required');
  }

  let event;
  try {
    if (!env.GITHUB_EVENT_PATH) block('event payload missing');
    event = await readEvent(env.GITHUB_EVENT_PATH);
  } catch {
    block('event payload unavailable');
  }
  if (event?.repository?.full_name !== REPOSITORY ||
      event?.issue?.number !== 2120 ||
      event?.issue?.pull_request != null ||
      event?.comment?.user?.login !== OWNER ||
      event?.comment?.author_association !== 'OWNER' ||
      event?.comment?.body !== COMMAND) {
    block('owner Issue #2120 exact command required');
  }

  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== 'string' || !token.trim()) {
    block('Production Management API secret unavailable');
  }
  // The route CAN execute writes in other calls; our request cannot because
  // the SQL is hard-coded SELECT and the Management API read_only flag is true.
  const response = await request(
    'https://api.supabase.com/v1/projects/' + PROJECT + '/database/query',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: SQL, read_only: true }),
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    }
  );
  if (response.status !== 201) {
    block('query route HTTP ' + response.status);
  }
  let rows;
  try {
    rows = await response.json();
  } catch {
    block('query route returned invalid JSON');
  }
  if (!Array.isArray(rows)) {
    block('query route response not Array<Row>');
  }
  validateReadOnlyRows(rows, 'before', 0);
  report('STEP05_QUERY_ROUTE_SELECT_OK: HTTP 201, Array<Row>, fixed SELECT, ' +
    'read_only=true, draft/private/terms empty/entries zero; no DB write. ' +
    'This does NOT prove write authorization or DO acceptance.');
  return true;
}

if (process.argv[1]?.endsWith('/november-contest-query-route-readonly-preflight.mjs')) {
  runQueryRouteSelectPreflight().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
