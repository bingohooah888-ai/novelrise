import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CODEX_AUTH_REPAIR_CONFIRMATION,
  classifyCodexLogin,
  redactCodexDiagnosticText
} from '../tools/novelight-commander/src/codex-auth.js';

const daemonPath = 'tools/novelight-commander/src/github-bridge-daemon.js';
const authPath = 'tools/novelight-commander/src/codex-auth.js';

test('Codex auth diagnostic redacts API keys and bearer tokens', () => {
  const input = [
    'OPENAI_API_KEY=sk-proj-abcdefghijklmnop',
    'Incorrect API key provided: sk-test-abcdefghijklmnop',
    'Authorization: Bearer abc.def.ghi'
  ].join('\n');
  const output = redactCodexDiagnosticText(input);

  assert.doesNotMatch(output, /sk-(?:proj|test)-abcdefghijklmnop/);
  assert.doesNotMatch(output, /abc\.def\.ghi/);
  assert.match(output, /REDACTED/);
});

test('Codex login classifier distinguishes ChatGPT, API key and workload identity', () => {
  assert.equal(classifyCodexLogin('Logged in using ChatGPT'), 'chatgpt');
  assert.equal(classifyCodexLogin('Logged in using API key'), 'api_key');
  assert.equal(
    classifyCodexLogin('Logged in using workload identity'),
    'workload_identity'
  );
});

test('Codex auth actions are fixed allowlist actions with confirmation-gated repair', async () => {
  const [daemon, auth] = await Promise.all([
    readFile(daemonPath, 'utf8'),
    readFile(authPath, 'utf8')
  ]);

  assert.match(daemon, /\['codex_auth_diagnose', actionCodexAuthDiagnose\]/);
  assert.match(
    daemon,
    /\['codex_auth_repair_user_override', actionCodexAuthRepairUserOverride\]/
  );
  assert.match(auth, /runCodex\(\['login', 'status'\]/);
  assert.match(auth, /runCodex\(\['doctor'\]/);
  assert.match(auth, /OPENAI_API_KEY/);
  assert.match(auth, /OPENAI_BASE_URL/);
  assert.match(auth, /OPENAI_FEDERATION_RULE_ID/);
  assert.match(auth, /OPENAI_IDENTITY_TOKEN_FILE/);
  assert.match(
    auth,
    /Machine-scope OPENAI_API_KEY is present; automatic repair is blocked/
  );
  assert.equal(
    CODEX_AUTH_REPAIR_CONFIRMATION,
    'CLEAR_USER_OPENAI_API_KEY_OVERRIDE'
  );
  assert.doesNotMatch(auth, /options\.(?:command|shell|script)/);
});

test('Codex auth diagnostics report presence only for environment credentials', async () => {
  const auth = await readFile(authPath, 'utf8');

  assert.match(auth, /secretValuesExposed: false/);
  assert.match(auth, /environmentPresence: presence/);
  assert.doesNotMatch(auth, /environmentValues/);
  assert.doesNotMatch(auth, /return\s+process\.env\.OPENAI_API_KEY/);
});
