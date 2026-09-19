import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read(
  'supabase/migrations/20260919151044_beta_author_preopen_access.sql'
);
const precheck = read(
  'supabase/checks/20260919151044_beta_author_preopen_access_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260919151044_beta_author_preopen_access_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260919151044_beta_author_preopen_access_rollback.sql'
);
const publicApi = read('api/beta-author-preregistration.js');
const adminApi = read('api/admin-beta-authors.js');
const adminHtml = read('admin-beta-authors.html');
const betaHtml = read('beta-authors.html');
const signupHtml = read('signup.html');
test('campaign contract includes a dedicated author preopen state', () => {
  for (const source of [publicApi, adminApi, adminHtml, betaHtml, signupHtml]) {
    assert.match(source, /AUTHOR_PREOPEN/);
  }
  assert.match(adminHtml, /先行作者プレオープン/);
  assert.match(betaHtml, /先行利用を始める/);
  assert.match(signupHtml, /先行登録時と同じメールアドレス/);
});

test('preopen migration extends state without opening raw preregistration data', () => {
  assert.match(
    migration,
    /state in \('PRE_REGISTRATION', 'AUTHOR_PREOPEN', 'BETA_OPEN', 'CLOSED'\)/
  );
  assert.match(
    migration,
    /grant select \(email_normalized, status\)[\s\S]*to supabase_auth_admin;/
  );
  assert.match(
    migration,
    /create policy beta_author_preregistrations_auth_preopen_lookup[\s\S]*to supabase_auth_admin[\s\S]*using \(status <> 'cancelled'\);/
  );
  assert.doesNotMatch(
    migration,
    /grant select on table public\.beta_author_preregistrations to supabase_auth_admin/
  );
});
test('Auth hook allows only non-cancelled preregistered emails during preopen', () => {
  assert.match(migration, /v_campaign_state = 'AUTHOR_PREOPEN'/);
  assert.match(migration, /event #>> '\{user,email\}'/);
  assert.match(
    migration,
    /preregistration\.email_normalized = v_email[\s\S]*preregistration\.status <> 'cancelled'/
  );
  assert.match(
    migration,
    /if v_is_preregistered then[\s\S]*return '\{\}'::jsonb;/
  );
  assert.match(migration, /'http_code', 403/);
  assert.match(migration, /v_campaign_state in \('BETA_OPEN', 'CLOSED'\)/);
  assert.doesNotMatch(migration, /security definer/i);
});

test('pre/postchecks enforce least privilege and rollback is fail-closed', () => {
  assert.match(
    precheck,
    /campaign state constraint drifted before preopen migration/
  );
  assert.match(precheck, /preopen Auth lookup column grants already exist/);
  assert.match(
    postcheck,
    /Auth admin preopen lookup column grants are missing/
  );
  assert.match(
    postcheck,
    /Auth admin must not receive broad preregistration SELECT/
  );
  assert.match(
    postcheck,
    /raw preregistrations must remain unreadable to client roles/
  );
  assert.match(
    rollback,
    /Return campaign state from AUTHOR_PREOPEN before rollback/
  );
  assert.match(
    rollback,
    /revoke select \(email_normalized, status\)[\s\S]*from supabase_auth_admin;/
  );
  assert.match(
    rollback,
    /state in \('PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED'\)/
  );
});

test('public preregistration intake remains closed outside PRE_REGISTRATION', () => {
  assert.match(publicApi, /const STATES = new Set\(\[[\s\S]*'AUTHOR_PREOPEN'/);
  assert.match(
    migration,
    /v_campaign_state = 'PRE_REGISTRATION'[\s\S]*'http_code', 403/
  );
  assert.match(
    signupHtml,
    /state==='AUTHOR_PREOPEN'[\s\S]*showAuthorPreopen\(\)/
  );
  assert.match(
    betaHtml,
    /campaignState==='AUTHOR_PREOPEN'[\s\S]*authorPreopenState/
  );
});
