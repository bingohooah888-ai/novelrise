import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createOfflineOwnerSessionCheck,
  evaluateOwnerSessionEvidence
} from '../api/_lib/ai/owner-session-evidence.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const DIFFERENT = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'synthetic-not-signed-session-check-only';
const NOW = 1800000000;

function signedClaims() {
  return {
    sub: OWNER,
    session_id: SESSION,
    role: 'authenticated',
    aud: 'authenticated',
    is_anonymous: false,
    iat: NOW - 60,
    exp: NOW + 120
  };
}
function row() {
  return { id: SESSION, user_id: OWNER };
}
function fakes() {
  const state = {
    calls: [],
    claims: signedClaims(),
    session: row(),
    verifiedError: null,
    lookupError: null,
    now: NOW,
    throwVerify: false,
    throwLookup: false
  };
  const verifySignedClaims = async (token) => {
    state.calls.push({ action: 'verifySignedClaims', matchesSyntheticToken: token === TOKEN });
    if (state.throwVerify) throw new Error('PRIVATE TOKEN FAILURE: ' + TOKEN);
    return { data: { claims: state.claims }, error: state.verifiedError };
  };
  const readExistingSession = async ({ sessionId, actorId }) => {
    state.calls.push({
      action: 'readExistingSession',
      expectedSession: sessionId === SESSION,
      expectedActor: actorId === OWNER
    });
    if (state.throwLookup) throw new Error('PRIVATE SESSION FAILURE');
    return { data: state.session, error: state.lookupError };
  };
  const nowEpochSeconds = () => state.now;
  const check = createOfflineOwnerSessionCheck({
    verifySignedClaims,
    readExistingSession,
    nowEpochSeconds
  });
  const input = () => ({ bearerToken: TOKEN, actorId: OWNER, novelId: 23 });
  return { state, input, check, verifySignedClaims, readExistingSession, nowEpochSeconds };
}
function calls(f, name) {
  return f.state.calls.filter((c) => c.action === name).length;
}

test('signed claims and existing owner session yield only an internal UUID binding', async () => {
  const f = fakes();
  const value = await f.check(f.input());
  assert.deepEqual(value, { active: true, binding: SESSION });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.keys(value).length, 2);
  assert.equal(calls(f, 'verifySignedClaims'), 1);
  assert.equal(calls(f, 'readExistingSession'), 1);
  assert.equal(JSON.stringify(f.state.calls).includes(TOKEN), false);
  assert.equal(JSON.stringify(value).includes(TOKEN), false);
});

test('pure evaluation is deterministic and does not mutate signed claims or session row', () => {
  const claims = signedClaims();
  const sessionRow = row();
  assert.deepEqual(
    evaluateOwnerSessionEvidence({
      actorId: OWNER.toUpperCase(),
      claims,
      sessionRow,
      epochSeconds: NOW
    }),
    { active: true, binding: SESSION }
  );
  assert.equal(claims.sub, OWNER);
  assert.equal(sessionRow.id, SESSION);
});

test('revoked server session, unknown session and foreign-owner row all fail closed', async () => {
  for (const newRow of [
    null,
    undefined,
    { ...row(), id: DIFFERENT },
    { ...row(), user_id: OTHER },
    { ...row(), id: null },
    { ...row(), user_id: null }
  ]) {
    const f = fakes();
    f.state.session = newRow;
    assert.equal(await f.check(f.input()), null);
    assert.equal(calls(f, 'readExistingSession'), 1);
  }
});

test('signed session_id and sub must belong to the verified outer actor', async () => {
  for (const claims of [
    { ...signedClaims(), sub: OTHER },
    { ...signedClaims(), session_id: DIFFERENT },
    { ...signedClaims(), session_id: null },
    { ...signedClaims(), sub: 'random' }
  ]) {
    const f = fakes();
    f.state.claims = claims;
    assert.equal(await f.check(f.input()), null);
  }
});

test('expired, future, malformed or anonymous claims cannot authorize owner drafts', async () => {
  for (const changes of [
    { exp: NOW }, { exp: NOW - 1 }, { iat: NOW + 1 },
    { nbf: NOW + 1 }, { exp: 'future' }, { iat: undefined },
    { role: 'anon' }, { aud: 'anon' }, { is_anonymous: true }
  ]) {
    const f = fakes();
    f.state.claims = { ...signedClaims(), ...changes };
    assert.equal(await f.check(f.input()), null);
  }
});

test('clock advancing during session lookup invalidates an expired JWT', async () => {
  const f = fakes();
  const lookup = async (args) => {
    f.state.now = NOW + 121;
    return f.readExistingSession(args);
  };
  const check = createOfflineOwnerSessionCheck({
    verifySignedClaims: f.verifySignedClaims,
    readExistingSession: lookup,
    nowEpochSeconds: f.nowEpochSeconds
  });
  assert.equal(await check(f.input()), null);
});

test('missing providers, malformed actor or malformed bearer never query the session', async () => {
  const f = fakes();
  const cases = [
    { bearerToken: null },
    { bearerToken: 'short' },
    { bearerToken: TOKEN + '\nmore' },
    { bearerToken: TOKEN + ' ' },
    { actorId: 'not-a-uuid' },
    { novelId: 0 },
    { novelId: '23e1' },
    { novelId: null }
  ];
  for (const change of cases) {
    assert.equal(await f.check({ ...f.input(), ...change }), null);
  }
  assert.equal(calls(f, 'verifySignedClaims'), 0);
  assert.equal(calls(f, 'readExistingSession'), 0);
  for (const missing of [
    { verifySignedClaims: null, readExistingSession: f.readExistingSession, nowEpochSeconds: f.nowEpochSeconds },
    { verifySignedClaims: f.verifySignedClaims, readExistingSession: null, nowEpochSeconds: f.nowEpochSeconds },
    { verifySignedClaims: f.verifySignedClaims, readExistingSession: f.readExistingSession, nowEpochSeconds: null }
  ]) {
    assert.equal(await createOfflineOwnerSessionCheck(missing)(f.input()), null);
  }
  assert.equal(calls(f, 'readExistingSession'), 0);
});

test('invalid signature verifier response and revoked/missing records return null', async () => {
  for (const change of [
    (s) => { s.verifiedError = { message: 'bad signature' }; },
    (s) => { s.claims = null; },
    (s) => { s.throwVerify = true; },
    (s) => { s.lookupError = { message: 'not permitted' }; },
    (s) => { s.throwLookup = true; }
  ]) {
    const f = fakes();
    change(f.state);
    assert.equal(await f.check(f.input()), null);
  }
});

test('each check observes the session again; cached successful decisions are not reused', async () => {
  const f = fakes();
  assert.deepEqual(await f.check(f.input()), { active: true, binding: SESSION });
  f.state.session = null; // signed-out session removed on the server
  assert.equal(await f.check(f.input()), null);
  assert.equal(calls(f, 'verifySignedClaims'), 2);
  assert.equal(calls(f, 'readExistingSession'), 2);
});

test('the new observer stays unmounted and cannot itself decode JWTs or read DB', async () => {
  const source = await readFile(
    new URL('../api/_lib/ai/owner-session-evidence.js', import.meta.url),
    'utf8'
  );
  const ownerAdapter = await readFile(
    new URL('../api/_lib/ai/owner-outline-internal-adapter.js', import.meta.url),
    'utf8'
  );
  const route = await readFile(
    new URL('../api/ai-owner-novel-bible.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(route, /owner-session-evidence|owner-outline-internal-adapter/);
  assert.doesNotMatch(ownerAdapter, /owner-session-evidence/);
  assert.doesNotMatch(source, /from\s*['"]@supabase\/|\.from\(|\.rpc\(|getSession\(|JSON\.parse\(|console\./);
  assert.match(source, /UNMOUNTED/);
  assert.match(source, /verifySignedClaims MUST cryptographically verify the JWT/);
});
