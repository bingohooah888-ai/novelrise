import assert from 'node:assert/strict';

export const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const OWNER = 'bingohooah888-ai';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{40}$/u;

function deny() {
  throw new Error('STAGING_READER_UI_GATE_DENIED');
}

export function assertOwnerStagingGate(env = process.env) {
  if (
    env.NOVELIGHT_READER_UI_PROOF_CLAIMED !== '1' ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'issue_comment' ||
    env.GITHUB_ACTOR !== OWNER ||
    env.GITHUB_TRIGGERING_ACTOR !== OWNER ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    !/^[1-9][0-9]*$/u.test(env.NOVELIGHT_ONE_TIME_COMMENT_ID || '') ||
    !SHA.test(env.NOVELIGHT_APPROVED_MAIN_SHA || '') ||
    env.GITHUB_SHA !== env.NOVELIGHT_APPROVED_MAIN_SHA ||
    env.STAGING_SUPABASE_URL !== 'https://' + STAGING_REF + '.supabase.co' ||
    !/^\/tmp\/novelight-[a-z0-9-]+$/u.test(env.STAGING_DATABASE_URL_FILE || '')
  ) {
    deny();
  }

  let url;
  try {
    url = new URL(env.STAGING_BASE_URL);
  } catch {
    deny();
  }
  if (
    url.protocol !== 'https:' ||
    !/^novelrise-[a-z0-9-]+-ranobe1\.vercel\.app$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    deny();
  }
  return url.origin;
}

export function assertStagingDbUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    deny();
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/u.test(
      parsed.hostname
    ) ||
    parsed.port !== '5432' ||
    parsed.username !== 'postgres.' + STAGING_REF ||
    !parsed.password ||
    parsed.pathname !== '/postgres' ||
    parsed.search ||
    parsed.hash
  ) {
    deny();
  }
  return {
    host: parsed.hostname,
    port: parsed.port,
    user: parsed.username,
    password: decodeURIComponent(parsed.password)
  };
}

export function readOnlyPreflightSql() {
  return [
    'BEGIN TRANSACTION READ ONLY;',
    'SELECT count(*) FROM (VALUES',
    " ('auth.users'),('public.scout_xp_ledger'),('public.scout_point_ledger'),",
    " ('novelight_formal_private.scout_level_state'),",
    " ('novelight_formal_private.scout_point_usage_wallets')",
    ') v(name) WHERE pg_catalog.to_regclass(v.name) IS NOT NULL;',
    'COMMIT;'
  ].join('\n');
}

export function readOnlySnapshotSql(userId) {
  if (!UUID.test(userId)) deny();
  const uid = "'" + userId + "'::uuid";
  return [
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    'SELECT json_build_object(',
    " 'auth',(SELECT count(*) FROM auth.users WHERE id=" + uid + '),',
    " 'level',(SELECT count(*) FROM novelight_formal_private.scout_level_state",
    ' WHERE user_id=' + uid +
      ' AND current_level=1 AND highest_level=1 AND level_progress_xp=0 AND revision=0),',
    " 'wallet',(SELECT count(*) FROM novelight_formal_private.scout_point_usage_wallets",
    ' WHERE user_id=' + uid +
      ' AND available_points=0 AND exchange_eligible_points=0 AND reserved_points=0 AND held_points=0 AND revision=0),',
    " 'xp',(SELECT count(*) FROM public.scout_xp_ledger WHERE user_id=" + uid + '),',
    " 'point',(SELECT count(*) FROM public.scout_point_ledger WHERE user_id=" + uid + ')',
    ');',
    'COMMIT;'
  ].join('\n');
}

export function assertReaderUiParity({ authId, uiId, summary, dom, database }) {
  if (!UUID.test(authId || '') || authId !== uiId) {
    throw new Error('STAGING_READER_UI_PARITY_DENIED');
  }
  try {
    assert.equal(summary?.level, 1);
    assert.equal(summary?.rank_tier, 1);
    assert.equal(summary?.total_xp, 0);
    assert.equal(summary?.point_balance, 0);
    assert.equal(dom?.level, 'Lv.1');
    assert.equal(dom?.point, '0');
    for (const [key, value] of Object.entries({
      auth: 1,
      level: 1,
      wallet: 1,
      xp: 0,
      point: 0
    })) {
      assert.equal(database?.[key], value);
    }
  } catch {
    throw new Error('STAGING_READER_UI_PARITY_DENIED');
  }
  return true;
}
