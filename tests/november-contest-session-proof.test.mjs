import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013152000_november_contest_session_proof.sql',
    import.meta.url
  ),
  'utf8'
);

const disposableProof = readFileSync(
  new URL('./rls/november-contest-integration.sql', import.meta.url),
  'utf8'
);

test('reader sessions are created and updated by server-only functions', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /public\.novelight_contest_begin_read_session/);
  assert.match(sql, /public\.novelight_contest_heartbeat_read_session/);
  assert.match(sql, /revoke all on function/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.doesNotMatch(
    sql,
    /grant (?:all|execute) on function[^;]+to (anon|authenticated)/i
  );
});

test('backend checks contest state and published work every session', () => {
  assert.match(sql, /v_contest\.status <> 'active'/);
  assert.match(sql, /v_contest\.public_visible is not true/);
  assert.match(sql, /v_now < v_contest\.starts_at/);
  assert.match(sql, /v_now >= v_contest\.ends_at/);
  assert.match(sql, /ep\.status = 'published'/);
  assert.match(sql, /n\.status = 'published'/);
  assert.match(sql, /n\.content_rating in \('general','sensitive_15'\)/);
  assert.match(sql, /n\.ai_usage in \('human','ai_assisted'\)/);
  assert.match(sql, /v_reader\.user_id = v_entry\.author_id/);
});

test('heartbeats rely on server time and bounded sequential progress', () => {
  assert.match(sql, /p_sequence <> v_session\.last_sequence \+ 1/);
  assert.match(sql, /v_delta := pg_catalog\.extract\(epoch from v_now/);
  assert.match(sql, /v_delta < 8 or v_delta > 45/);
  assert.match(sql, /pg_catalog\.least\(/);
  assert.match(sql, /p_progress_ratio > 1/);
  assert.match(sql, /v_ratio >= 0\.8/);
  assert.match(sql, /v_session\.reading_mode = 'tts' then 45 else 30/);
  assert.match(sql, /p_foreground and p_interacted/);
  assert.match(sql, /v_qualified :=/);
  assert.match(sql, /'provisional_only',true/);
});

test('disposable DB cases include guest TTS and background rejection', () => {
  assert.match(disposableProof, /Stage 06 part B/);
  assert.match(disposableProof, /Guest took over account session/);
  assert.match(disposableProof, /Immediate fake completion heartbeat accepted/);
  assert.match(
    disposableProof,
    /Four sequential valid heartbeats not qualified/
  );
  assert.match(disposableProof, /TTS verified interval failed/);
  assert.match(disposableProof, /Background time produced contest credit/);
  assert.match(disposableProof, /Draft contest accepted a heartbeat/);
});
