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
const signup = read('signup.html');
const publicInviteApi = read('api/beta-author-invite.js');
const adminInviteApi = read('api/admin-beta-author-invites.js');

test('secure invite ledger stores hashes only and remains private', () => {
  assert.match(migration, /create table public\.beta_author_invites/);
  assert.match(migration, /token_hash text not null unique/);
  assert.doesNotMatch(
    migration.match(/create table public\.beta_author_invites \([\s\S]*?\n\);/)?.[0] ?? '',
    /\braw_token\b|\binvite_token\b|\btoken text\b/
  );
  assert.match(
    migration,
    /alter table public\.beta_author_invites enable row level security/
  );
  assert.match(
    migration,
    /revoke all on table public\.beta_author_invites[\s\S]*from public, anon, authenticated/
  );
});

test('Before User Created hook requires invite proof during author preopen', () => {
  assert.match(migration, /novelight_invite_token/);
  assert.match(migration, /pg_catalog\.sha256/);
  assert.match(migration, /v_campaign_state = 'AUTHOR_PREOPEN'/);
  assert.match(migration, /if v_has_valid_invite then[\s\S]*return '\{\}'::jsonb/);
  assert.match(migration, /i\.sent_at is not null/);
  assert.match(migration, /i\.consumed_at is null/);
  assert.match(migration, /i\.revoked_at is null/);
  assert.match(migration, /i\.expires_at > now\(\)/);
  assert.match(migration, /p\.email_normalized = v_email/);
});

test('beta-open protects still-unlinked preregistered email identities', () => {
  assert.match(migration, /v_is_reserved and not v_has_valid_invite/);
  assert.match(migration, /Founding Author資格を安全に紐付けるため/);
  assert.match(migration, /v_campaign_state in \('BETA_OPEN', 'CLOSED'\)/);
});

test('post-insert invite consumption binds explicit Auth identity and scrubs token', () => {
  assert.match(migration, /novelight_consume_beta_author_invite/);
  assert.match(migration, /redeemed_auth_user_id = new\.id/);
  assert.match(migration, /auth_user_id = new\.id/);
  assert.match(migration, /email_verified = true/);
  assert.match(migration, /- 'novelight_invite_token'/);
  assert.match(
    migration,
    /create trigger novelight_auth_user_00_consume_beta_author_invite/
  );
});

test('Founding linkage no longer falls back to email-value matching', () => {
  const sync = migration.match(
    /create or replace function public\.novelight_sync_user_participation_qualifications\([\s\S]*?\n\$\$;/
  )?.[0] ?? '';
  assert.match(sync, /where p\.auth_user_id = p_user_id/);
  assert.doesNotMatch(sync, /p\.email_normalized = v_email/);

  const assign = migration.match(
    /create or replace function public\.assign_beta_author_founding_qualification\(\)[\s\S]*?\n\$\$;/
  )?.[0] ?? '';
  assert.doesNotMatch(assign, /auth\.users/);
  assert.doesNotMatch(assign, /email_normalized/);
});

test('signup keeps invite bearer out of URL query and passes it only to Auth metadata', () => {
  assert.match(signup, /location\.hash/);
  assert.match(signup, /history\.replaceState/);
  assert.match(signup, /\/api\/beta-author-invite/);
  assert.match(signup, /novelight_invite_token=inviteToken/);
  assert.doesNotMatch(signup, /[?&]invite=/);
});

test('invite validation is same-origin and never returns preregistration PII', () => {
  assert.match(publicInviteApi, /isSameOriginRequest/);
  assert.match(publicInviteApi, /Cache-Control/);
  assert.match(publicInviteApi, /tokenHash/);
  assert.doesNotMatch(publicInviteApi, /\.select\([^)]*email/);
  assert.doesNotMatch(publicInviteApi, /pen_name/);
});

test('Resend sending is idempotent and gated to AUTHOR_PREOPEN', () => {
  assert.match(adminInviteApi, /state !== 'AUTHOR_PREOPEN'/);
  assert.match(adminInviteApi, /Idempotency-Key/);
  assert.match(adminInviteApi, /invite\.sent_at/);
  assert.match(adminInviteApi, /RESEND_API_KEY/);
  assert.match(adminInviteApi, /resend_email_id/);
});

test('migration verification and rollback are fail-closed', () => {
  assert.match(precheck, /requires PRE_REGISTRATION/);
  assert.match(postcheck, /Raw invite token column must never exist/);
  assert.match(postcheck, /Founding Author sync still trusts email-value matching/);
  assert.match(rollback, /Secure invite rollback blocked: real invite history exists/);
  assert.match(rollback, /Do not restore email-only Founding linkage/);
});
