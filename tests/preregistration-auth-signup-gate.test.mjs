import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const config = read('supabase/config.toml');
const migration = read(
  'supabase/migrations/20260915113000_preregistration_auth_signup_gate.sql'
);
const precheck = read(
  'supabase/checks/20260915113000_preregistration_auth_signup_gate_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260915113000_preregistration_auth_signup_gate_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260915113000_preregistration_auth_signup_gate_rollback.sql'
);

test('local Supabase config enables the Before User Created Postgres hook', () => {
  assert.match(config, /\[auth\.hook\.before_user_created\]/);
  assert.match(config, /enabled\s*=\s*true/);
  assert.match(
    config,
    /uri\s*=\s*"pg-functions:\/\/postgres\/public\/hook_novelight_beta_signup_gate"/
  );
});

test('signup hook uses the private campaign singleton without SECURITY DEFINER', () => {
  assert.match(
    migration,
    /create or replace function public\.hook_novelight_beta_signup_gate\(event jsonb\)/
  );
  assert.match(migration, /language plpgsql/);
  assert.match(migration, /stable/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(
    migration,
    /from public\.beta_author_preregistration_config as config[\s\S]*where config\.id = 1;/
  );
});

test('signup hook blocks only preregistration and fails closed on unavailable state', () => {
  assert.match(migration, /v_campaign_state = 'PRE_REGISTRATION'/);
  assert.match(migration, /'http_code', 403/);
  assert.match(migration, /v_campaign_state in \('BETA_OPEN', 'CLOSED'\)/);
  assert.match(migration, /return '\{\}'::jsonb;/);
  assert.equal((migration.match(/'http_code', 503/g) ?? []).length, 2);
});

test('Auth hook receives least-privilege access while client roles stay blocked', () => {
  assert.match(
    migration,
    /grant select on table public\.beta_author_preregistration_config to supabase_auth_admin;/
  );
  assert.match(
    migration,
    /create policy beta_author_preregistration_config_auth_signup_gate[\s\S]*to supabase_auth_admin[\s\S]*using \(id = 1\);/
  );
  assert.match(
    migration,
    /revoke execute on function public\.hook_novelight_beta_signup_gate\(jsonb\)[\s\S]*from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.hook_novelight_beta_signup_gate\(jsonb\)[\s\S]*to supabase_auth_admin;/
  );
});

test('precheck and postcheck protect RLS, privileges and campaign behavior', () => {
  assert.match(precheck, /beta_author_preregistration_config RLS must be enabled/);
  assert.match(precheck, /supabase_auth_admin role is required/);
  assert.match(postcheck, /RLS must remain enabled/);
  assert.match(postcheck, /must remain SECURITY INVOKER/);
  assert.match(postcheck, /PRE_REGISTRATION must reject new Auth users/);
  assert.match(postcheck, /BETA_OPEN\/CLOSED must allow normal Auth signup/);
  assert.match(postcheck, /has_function_privilege\('supabase_auth_admin'/);
});

test('rollback removes only the signup-gate objects and preserves shared schema usage', () => {
  assert.match(
    rollback,
    /drop function if exists public\.hook_novelight_beta_signup_gate\(jsonb\);/
  );
  assert.match(
    rollback,
    /drop policy if exists beta_author_preregistration_config_auth_signup_gate/
  );
  assert.match(
    rollback,
    /revoke select on table public\.beta_author_preregistration_config[\s\S]*from supabase_auth_admin;/
  );
  assert.doesNotMatch(rollback, /revoke usage on schema public/i);
});
