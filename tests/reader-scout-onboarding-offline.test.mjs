import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  preflightReaderMailbox,
  receiveReaderConfirmation,
  requireReaderMailbox,
  requireSignupVerificationLink,
  parseReaderConfirmation,
  uniqueReaderAddress
} from './e2e/staging/reader-scout-confirmation-mailbox.mjs';
import {
  STAGING_REF,
  assertOwnerStagingGate,
  assertReaderUiParity,
  assertStagingDbUrl,
  readOnlyPreflightSql,
  readOnlySnapshotSql
} from './e2e/staging/reader-scout-guard.mjs';

const sha = '0347553932229ea3dee26c66335c2a7723c2ba59';
const uuid = '11111111-2222-4333-8444-555555555555';
const safe = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'issue_comment',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: sha,
  NOVELIGHT_APPROVED_MAIN_SHA: sha,
  NOVELIGHT_READER_UI_PROOF_CLAIMED: '1',
  NOVELIGHT_ONE_TIME_COMMENT_ID: '1234',
  STAGING_SUPABASE_URL: 'https://' + STAGING_REF + '.supabase.co',
  STAGING_DATABASE_URL_FILE: '/tmp/novelight-reader-ui-db',
  STAGING_BASE_URL: 'https://novelrise-abc123-ranobe1.vercel.app'
};
const dbUrl =
  'postgresql://postgres.' +
  STAGING_REF +
  ':offline-only@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

test('Staging browser gate requires exact OWNER, claimed, one-use and Preview', () => {
  assert.equal(
    assertOwnerStagingGate(safe),
    'https://novelrise-abc123-ranobe1.vercel.app'
  );
  const rejected = [
    { GITHUB_ACTOR: 'unknown' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { NOVELIGHT_READER_UI_PROOF_CLAIMED: '' },
    { NOVELIGHT_ONE_TIME_COMMENT_ID: '' },
    { NOVELIGHT_APPROVED_MAIN_SHA: '0'.repeat(40) },
    { GITHUB_SHA: '0'.repeat(40) },
    { STAGING_SUPABASE_URL: 'https://production.supabase.co' },
    { STAGING_BASE_URL: 'https://novelight.jp' },
    { STAGING_BASE_URL: 'http://novelrise-abc123-ranobe1.vercel.app' },
    { STAGING_BASE_URL: 'https://novelrise.vercel.app' },
    { STAGING_DATABASE_URL_FILE: '/tmp/../production-url' }
  ];
  for (const invalid of rejected) {
    assert.throws(
      () => assertOwnerStagingGate({ ...safe, ...invalid }),
      /STAGING_READER_UI_GATE_DENIED/u
    );
  }
});

test('Staging database guard refuses Production and unsafe transport', () => {
  const parsed = assertStagingDbUrl(dbUrl);
  assert.equal(parsed.user, 'postgres.' + STAGING_REF);
  assert.equal(parsed.port, '5432');
  for (const invalid of [
    dbUrl.replace('aws-0-ap-northeast-1', 'aws-0-us-east-1'),
    dbUrl.replace('pooler.supabase.com', 'other.example'),
    dbUrl.replace(':5432/', ':6543/'),
    dbUrl.replace('postgres.' + STAGING_REF, 'postgres.production'),
    dbUrl.replace('postgresql:', 'http:'),
    dbUrl.replace('/postgres', '/postgres?sslmode=disable'),
    ''
  ]) {
    assert.throws(
      () => assertStagingDbUrl(invalid),
      /STAGING_READER_UI_GATE_DENIED/u
    );
  }
});

test('Staging DB preflight and snapshot are read-only and bound to one UUID', () => {
  const preflight = readOnlyPreflightSql();
  const snapshot = readOnlySnapshotSql(uuid);
  for (const sql of [preflight, snapshot]) {
    assert.match(sql, /BEGIN TRANSACTION/u);
    assert.match(sql, /READ ONLY/u);
    assert.doesNotMatch(
      sql,
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/iu
    );
  }
  assert.match(snapshot, /novelight_formal_private\.scout_level_state/u);
  assert.match(
    snapshot,
    /novelight_formal_private\.scout_point_usage_wallets/u
  );
  assert.match(snapshot, /public\.scout_point_ledger/u);
  assert.match(snapshot, /public\.scout_xp_ledger/u);
  assert.throws(
    () => readOnlySnapshotSql('x; DELETE FROM auth.users'),
    /STAGING_READER_UI_GATE_DENIED/u
  );
});

const approved = {
  authId: uuid,
  uiId: uuid,
  summary: { level: 1, rank_tier: 1, total_xp: 0, point_balance: 0 },
  dom: { level: 'Lv.1', point: '0' },
  database: { auth: 1, level: 1, wallet: 1, xp: 0, point: 0 }
};

test('The same authenticated user must match both UI and private rows', () => {
  assert.equal(assertReaderUiParity(approved), true);
  for (const invalid of [
    { uiId: '66666666-7777-4888-9999-aaaaaaaaaaaa' },
    { summary: { ...approved.summary, point_balance: undefined } },
    { summary: { ...approved.summary, level: 2 } },
    { dom: { ...approved.dom, point: '—' } },
    { database: { ...approved.database, level: 0 } },
    { database: { ...approved.database, wallet: 0 } },
    { database: { ...approved.database, point: 1 } }
  ]) {
    assert.throws(
      () => assertReaderUiParity({ ...approved, ...invalid }),
      /STAGING_READER_UI_PARITY_DENIED/u
    );
  }
});

test('Actual SCOUT RECORD renderer maps initial RPC values to DOM', () => {
  const source = readFileSync('novelight-scout-record.js', 'utf8');
  const start = source.indexOf('  function renderSummary(summary) {');
  const end = source.indexOf('\n  function renderSeedInventory', start);
  assert.ok(start > 0 && end > start);
  const rendered = new Map();
  runInNewContext(
    source.slice(start, end) +
      '\nrenderSummary({level:1,rank_tier:1,total_xp:0,point_balance:0});',
    {
      n: (value) => Number(value || 0).toLocaleString('ja-JP'),
      setText: (id, value) => rendered.set(id, value),
      rankNames: ['', 'NOCTIS'],
      rankArtworkPaths: ['', 'scout-rank.png'],
      document: {
        getElementById: () => ({
          classList: { add() {} },
          replaceChildren() {}
        }),
        createElement: () => ({})
      },
      setLevelProgress() {},
      renderRankPath() {}
    },
    { timeout: 1000 }
  );
  assert.equal(rendered.get('rankLevel'), 'Lv.1');
  assert.equal(rendered.get('pointBalance'), '0');
});

const previewOrigin = 'https://novelrise-abc123-ranobe1.vercel.app';
const receiptId = '11111111-2222-4333-8444-555555555555';
const mailboxEnv = {
  NOVELIGHT_STAGING_READER_MAILBOX_DOMAIN: 'readerproof.resend.app',
  NOVELIGHT_STAGING_READER_MAILBOX_SENDER: 'auth@novelight.jp',
  NOVELIGHT_STAGING_READER_MAILBOX_API_KEY: 're_offline_fake_key_only'
};
const mailbox = requireReaderMailbox(mailboxEnv);
const recipient = uniqueReaderAddress(mailbox, receiptId);
const confirmation =
  'https://' +
  STAGING_REF +
  '.supabase.co/auth/v1/verify?token=' +
  'A'.repeat(32) +
  '&type=signup&redirect_to=' +
  encodeURIComponent(previewOrigin + '/index.html');
const mail = {
  to: [recipient],
  from: 'NOVELIGHT <auth@novelight.jp>',
  subject: '【NOVELIGHT】メールアドレスの確認',
  html: '<a href="' + confirmation.replaceAll('&', '&amp;') + '">確認</a>',
  text: ''
};

test('Staging mailbox must be dedicated, configured and never an invalid address', () => {
  assert.equal(mailbox.domain, 'readerproof.resend.app');
  assert.equal(recipient.endsWith('@readerproof.resend.app'), true);
  for (const invalid of [
    { NOVELIGHT_STAGING_READER_MAILBOX_DOMAIN: 'novelight.jp' },
    { NOVELIGHT_STAGING_READER_MAILBOX_DOMAIN: 'example.invalid' },
    { NOVELIGHT_STAGING_READER_MAILBOX_API_KEY: '' },
    { NOVELIGHT_STAGING_READER_MAILBOX_SENDER: '' }
  ]) {
    assert.throws(
      () => requireReaderMailbox({ ...mailboxEnv, ...invalid }),
      /STAGING_READER_MAILBOX_DENIED/u
    );
  }
  assert.throws(
    () => uniqueReaderAddress(mailbox, 'not-a-uuid'),
    /STAGING_READER_MAILBOX_DENIED/u
  );
});

test('Only a real Staging signup confirmation link returning to pinned Preview is accepted', () => {
  assert.equal(
    parseReaderConfirmation(mail, recipient, mailbox.sender, previewOrigin),
    confirmation
  );
  for (const unsafe of [
    confirmation.replace(STAGING_REF, 'fiepaguycecrredwrcwx'),
    confirmation.replace('type=signup', 'type=recovery'),
    confirmation.replace('auth/v1/verify', 'auth/v1/admin'),
    confirmation.replace(
      encodeURIComponent(previewOrigin + '/index.html'),
      encodeURIComponent('https://novelight.jp/index.html')
    ),
    confirmation.replace('token=' + 'A'.repeat(32), 'token='),
    'https://evil.example/confirm'
  ]) {
    assert.throws(
      () => requireSignupVerificationLink(unsafe, previewOrigin),
      /STAGING_READER_MAILBOX_DENIED/u
    );
  }
  assert.throws(
    () => parseReaderConfirmation({ ...mail, from: 'evil@example.com' }, recipient, mailbox.sender, previewOrigin),
    /STAGING_READER_MAILBOX_DENIED/u
  );
  assert.throws(
    () => parseReaderConfirmation({ ...mail, to: ['other@example.com'] }, recipient, mailbox.sender, previewOrigin),
    /STAGING_READER_MAILBOX_DENIED/u
  );
});

test('Inbox preflight and one-use receipt read only approved Resend GET endpoints', async () => {
  const calls = [];
  const sentAt = Date.now();
  const fetchedMail = {
    id: receiptId,
    to: [recipient],
    from: mail.from,
    subject: mail.subject,
    created_at: new Date(sentAt).toISOString()
  };
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect });
    if (url.endsWith('?limit=30')) {
      return { ok: true, json: async () => ({ object: 'list', data: [fetchedMail] }) };
    }
    if (url.endsWith('/' + receiptId)) {
      return { ok: true, json: async () => mail };
    }
    throw new Error('unexpected GET');
  };
  assert.equal(await preflightReaderMailbox(mailbox, fetcher), true);
  const link = await receiveReaderConfirmation({
    mailbox,
    recipient,
    previewOrigin,
    sinceMs: sentAt,
    fetcher,
    sleep: async () => {
      throw new Error('should not poll again');
    },
    maxPolls: 2
  });
  assert.equal(link, confirmation);
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.method === 'GET'), true);
  assert.equal(calls.every((call) => call.redirect === 'error'), true);
  assert.equal(
    calls.every((call) => call.url.startsWith('https://api.resend.com/emails/receiving')),
    true
  );
  await assert.rejects(
    receiveReaderConfirmation({
      mailbox,
      recipient,
      previewOrigin,
      sinceMs: sentAt,
      fetcher: async () => ({ ok: false }),
      maxPolls: 1
    }),
    /STAGING_READER_MAILBOX_DENIED/u
  );
});

test('Missing mailbox configuration denies E2E before any browser signup', () => {
  const source = readFileSync(
    'tests/e2e/staging/reader-scout-onboarding.spec.js',
    'utf8'
  );
  const config = source.indexOf('requireReaderMailbox(process.env)');
  const preflight = source.indexOf('await preflightReaderMailbox(mailbox)');
  const signup = source.indexOf(
    "page.goto(origin + '/signup.html?redirect=scout-record.html')"
  );
  const confirm = source.indexOf('await receiveReaderConfirmation(');
  const login = source.indexOf("page.goto(origin + '/login.html?redirect=scout-record.html')");
  assert.ok(config > 0 && preflight > config && signup > preflight);
  assert.ok(confirm > signup && login > confirm);
  assert.doesNotMatch(source, /email_confirm:|signInWithOtp/u);
});

test('Real Staging browser proof uses normal signup/login without bypass or retry', () => {
  const source = readFileSync(
    'tests/e2e/staging/reader-scout-onboarding.spec.js',
    'utf8'
  );
  const signup = readFileSync('signup.html', 'utf8');
  const login = readFileSync('login.html', 'utf8');
  const scout = readFileSync('novelight-scout-record.js', 'utf8');
  assert.match(signup, /client\.auth\.signUp/u);
  assert.match(login, /auth\.signInWithPassword/u);
  assert.match(scout, /novelight_scout_record_summary/u);
  for (const pattern of [
    /assertOwnerStagingGate\(process\.env\)/u,
    /test\.describe\.configure\(\{ retries: 0/u,
    /trace: 'off', screenshot: 'off', video: 'off'/u,
    /staging-desktop-chromium/u,
    /page\.locator\('#signupButton'\)\.click/u,
    /page\.locator\('#loginButton'\)\.click/u,
    /auth\.admin\.updateUserById\(authId/u,
    /client\.auth\.getUser/u,
    /client\.rpc\('novelight_scout_record_summary'\)/u,
    /page\.locator\('#rankLevel'\)/u,
    /page\.locator\('#pointBalance'\)/u,
    /assertReaderUiParity/u,
    /STAGING_READER_UI_STOPPED_NO_RETRY/u
  ]) {
    assert.match(source, pattern);
  }
  assert.doesNotMatch(
    source,
    /workflow_dispatch|signInWithOtp|email_confirm:|db push/u
  );
});
