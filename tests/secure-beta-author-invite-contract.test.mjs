import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read(
  'supabase/migrations/20260923064500_secure_beta_author_invites.sql'
);
const precheck = read(
  'supabase/checks/20260923064500_secure_beta_author_invites_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260923064500_secure_beta_author_invites_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260923064500_secure_beta_author_invites_rollback.sql'
);
const inviteApi = read('api/admin-beta-author-invites.js');
const validationApi = read('api/beta-author-invite.js');
const signup = read('signup.html');
const adminApi = read('api/admin-beta-authors.js');
const adminHtml = read('admin-beta-authors.html');

test('secure invite ledger is private and never persists raw bearer tokens', () => {
  assert.match(migration, /create table public\.beta_author_invites/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(
    migration,
    /alter table public\.beta_author_invites enable row level security/
  );
  assert.match(
    migration,
    /revoke all on table public\.beta_author_invites[\s\S]*from public, anon, authenticated/
  );
  assert.doesNotMatch(
    migration.match(
      /create table public\.beta_author_invites \([\s\S]*?\n\);/
    )?.[0] ?? '',
    /\b(raw_token|invite_token|token)\s+text\b/
  );
  assert.match(postcheck, /Raw invite token column must never exist/);
});

test('Before User Created requires invite proof during preopen and protects reserved emails after launch', () => {
  assert.match(migration, /novelight_invite_token/);
  assert.match(migration, /pg_catalog\.sha256/);
  assert.match(migration, /i\.sent_at is not null/);
  assert.match(migration, /i\.consumed_at is null/);
  assert.match(migration, /i\.revoked_at is null/);
  assert.match(migration, /i\.expires_at > now\(\)/);
  assert.match(migration, /p\.email_normalized = v_email/);
  assert.match(migration, /v_campaign_state = 'AUTHOR_PREOPEN'/);
  assert.match(migration, /if v_has_valid_invite then/);
  assert.match(
    migration,
    /v_campaign_state in \('BETA_OPEN', 'CLOSED'\)[\s\S]*v_is_reserved and not v_has_valid_invite/
  );
  assert.doesNotMatch(
    migration.match(
      /create or replace function public\.hook_novelight_beta_signup_gate\(event jsonb\)[\s\S]*?\$\$;/
    )?.[0] ?? '',
    /security definer/i
  );
});

test('invite consumption explicitly binds Founding identity and scrubs transport metadata', () => {
  const consume =
    migration.match(
      /create or replace function public\.novelight_consume_beta_author_invite\(\)[\s\S]*?\$\$;/
    )?.[0] ?? '';
  assert.match(consume, /for update of i, p/);
  assert.match(consume, /consumed_at = pg_catalog\.now\(\)/);
  assert.match(consume, /redeemed_auth_user_id = new\.id/);
  assert.match(consume, /auth_user_id = new\.id/);
  assert.match(consume, /email_verified = true/);
  assert.match(consume, /- 'novelight_invite_token'/);
  assert.match(
    migration,
    /create trigger novelight_auth_user_00_consume_beta_author_invite[\s\S]*after insert on auth\.users/
  );
});

test('Founding qualification no longer trusts email-value matching', () => {
  const sync =
    migration.match(
      /create or replace function public\.novelight_sync_user_participation_qualifications\([\s\S]*?\$\$;/
    )?.[0] ?? '';
  const allocator =
    migration.match(
      /create or replace function public\.assign_beta_author_founding_qualification\(\)[\s\S]*?\$\$;/
    )?.[0] ?? '';

  assert.match(sync, /where p\.auth_user_id = p_user_id/);
  assert.doesNotMatch(sync, /p\.email_normalized = v_email/);
  assert.doesNotMatch(allocator, /auth\.users/);
  assert.doesNotMatch(allocator, /email_normalized/);
  assert.match(
    postcheck,
    /Founding Author sync still trusts email-value matching/
  );
});

test('signup keeps invite token in the URL fragment and only submits it after server validation', () => {
  assert.match(signup, /location\.hash/);
  assert.match(signup, /history\.replaceState/);
  assert.match(signup, /fetch\('\/api\/beta-author-invite'/);
  assert.match(
    signup,
    /if\(inviteValidated\)signupMetadata\.novelight_invite_token=inviteToken/
  );
  assert.match(validationApi, /isSameOriginRequest/);
  assert.match(validationApi, /createHash\('sha256'/);
  assert.match(validationApi, /\.eq\('token_hash', hash\)/);
  assert.doesNotMatch(validationApi, /console\.log/);
});

test('ADMIN outbound send is authenticated, idempotent and gated away from preregistration', () => {
  assert.match(inviteApi, /requireAdmin/);
  assert.match(inviteApi, /RESEND_API_KEY/);
  assert.match(inviteApi, /Idempotency-Key/);
  assert.match(inviteApi, /novelight-beta-author-invite-/);
  assert.match(inviteApi, /state !== 'AUTHOR_PREOPEN'/);
  assert.match(inviteApi, /token_hash: tokenHash/);
  assert.match(inviteApi, /url\.hash = `invite=/);
  assert.match(inviteApi, /if \(invite\.sent_at\)/);
  assert.match(inviteApi, /row\.sent_at && !row\.consumed_at/);
  assert.match(adminHtml, /実メール送信です。実行しますか/);
});

test('campaign transition fails closed until invite storage and Resend secret are ready', () => {
  assert.match(adminApi, /assertInviteInfrastructureReady/);
  assert.match(
    adminApi,
    /if \(!\['AUTHOR_PREOPEN', 'BETA_OPEN'\]\.includes\(nextState\)\) return/
  );
  assert.match(adminApi, /from\('beta_author_invites'\)/);
  assert.match(adminApi, /RESEND_API_KEY/);
  assert.match(adminApi, /INVITE_GATE_NOT_READY/);
});

test('manual ADMIN cannot forge email verification or invite-sent milestones', () => {
  assert.match(
    adminApi,
    /SYSTEM_OWNED_STATUSES = new Set\(\['verified', 'invited'\]\)/
  );
  assert.match(adminApi, /SYSTEM_OWNED_STATUSES\.has\(status\)/);
  assert.doesNotMatch(adminApi, /patch\.email_verified = true/);
  assert.doesNotMatch(adminApi, /patch\.invite_sent_at =/);
  assert.match(
    adminHtml,
    /systemOwned=option\.value==='verified'\|\|option\.value==='invited'/
  );
});

test('pre/postchecks and rollback preserve fail-closed identity protection', () => {
  assert.match(precheck, /Secure invite migration requires PRE_REGISTRATION/);
  assert.match(precheck, /Participation sync baseline is not recognized/);
  assert.match(postcheck, /Secure signup hook contract is incomplete/);
  assert.match(
    postcheck,
    /Invite consume trigger must sort before participation sync/
  );
  assert.match(
    rollback,
    /Secure invite rollback blocked: real invite history exists/
  );
  assert.match(rollback, /Do not restore email-only Founding linkage/);
  assert.doesNotMatch(
    rollback,
    /or \(v_email <> '' and p\.email_normalized = v_email\)/
  );
});
