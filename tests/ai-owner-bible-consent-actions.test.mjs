import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerNovelBibleConsentActions } from '../api/_lib/ai/owner-novel-bible-consent-actions.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const REVISION = 'novel-bible-2026-10-30-v1';
const EXPIRES = '2026-11-29T10:00:00Z';
const GRANT = {
  token: TOKEN,
  novelId: 41,
  processor: 'openai',
  explicitAuthorAction: true,
  acceptedExternalProcessing: true,
  acceptedDisclosureRevision: REVISION
};
const REVOKE = {
  token: TOKEN,
  novelId: 41,
  processor: 'openai',
  explicitAuthorAction: true
};

function fixture({
  enabled = true,
  actor = OWNER,
  novelOwner = OWNER,
  novelId = 41,
  rpcError = false,
  authError = false,
  failOwnership = false
} = {}) {
  const state = { auth: 0, workReads: 0, writes: [], revoked: false };
  const client = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        state.auth += 1;
        return {
          data: { user: { id: actor } },
          error: authError ? { code: 'AUTH_ERROR' } : null
        };
      }
    },
    from(table) {
      assert.equal(table, 'novels');
      return {
        select() {
          return this;
        },
        eq(column, id) {
          assert.equal(column, 'id');
          assert.equal(id, 41);
          return this;
        },
        async maybeSingle() {
          state.workReads += 1;
          return {
            data: { id: novelId, user_id: novelOwner },
            error: failOwnership ? { code: 'RLS_DENIED' } : null
          };
        }
      };
    },
    async rpc(name, args) {
      state.writes.push({ name, args });
      assert.equal(args.p_actor_id, OWNER);
      assert.equal(args.p_novel_id, 41);
      assert.equal(args.p_processor, 'openai');
      if (rpcError) return { data: null, error: { code: 'DB_DOWN' } };
      if (name === 'novelight_ai_consent_grant') {
        assert.equal(args.p_policy_revision, REVISION);
        state.revoked = false;
        return {
          data: {
            status: 'granted',
            processor: 'openai',
            policyRevision: REVISION,
            expiresAt: EXPIRES
          },
          error: null
        };
      }
      if (name === 'novelight_ai_consent_revoke') {
        assert.equal(Object.keys(args).length, 3);
        state.revoked = true;
        return {
          data: {
            status: 'revoked',
            processor: 'openai',
            revokedAt: '2026-10-30T10:00:00Z'
          },
          error: null
        };
      }
      throw new Error('UNEXPECTED_RPC');
    }
  };
  return {
    state,
    actions: createOwnerNovelBibleConsentActions({
      enabled,
      ownerId: OWNER,
      authClient: client,
      serviceClient: client,
      policyRevision: REVISION
    })
  };
}

test('default OFF blocks grant and revoke before Auth or any DB access', async () => {
  const { actions, state } = fixture({ enabled: false });
  await assert.rejects(actions.grant(GRANT), /AI_CONSENT_ACTION_DISABLED/u);
  await assert.rejects(actions.revoke(REVOKE), /AI_CONSENT_ACTION_DISABLED/u);
  assert.equal(state.auth, 0);
  assert.equal(state.workReads, 0);
  assert.equal(state.writes.length, 0);
});

test('missing explicit click and current disclosure acceptance deny grants', async () => {
  const { actions, state } = fixture();
  for (const params of [
    { explicitAuthorAction: false },
    { acceptedExternalProcessing: false },
    { acceptedDisclosureRevision: 'outdated-policy-v1' }
  ]) {
    await assert.rejects(
      actions.grant({ ...GRANT, ...params }),
      /AI_CONSENT_ACTION_DENIED/u
    );
  }
  assert.equal(state.writes.length, 0);
});

test('no other user, novel owner, malformed work or processor may grant', async () => {
  for (const opts of [
    { actor: OTHER },
    { novelOwner: OTHER },
    { novelId: 42 },
    { authError: true },
    { failOwnership: true }
  ]) {
    const { actions, state } = fixture(opts);
    await assert.rejects(actions.grant(GRANT), /AI_CONSENT_ACTION_DENIED/u);
    assert.equal(state.writes.length, 0);
  }
  const { actions, state } = fixture();
  for (const params of [
    { processor: 'unknown' },
    { novelId: '41' },
    { token: 'short' },
    { token: TOKEN + '\n' }
  ]) {
    await assert.rejects(
      actions.grant({ ...GRANT, ...params }),
      /AI_CONSENT_ACTION_DENIED/u
    );
  }
  assert.equal(state.writes.length, 0);
});

test('grant writes only a server-derived actor, work, processor and revision', async () => {
  const { actions, state } = fixture();
  const result = await actions.grant(GRANT);
  assert.deepEqual(result, {
    novelId: 41,
    processor: 'openai',
    status: 'granted',
    policyRevision: REVISION,
    expiresAt: EXPIRES,
    aiEnabled: false
  });
  assert.deepEqual(state.writes, [
    {
      name: 'novelight_ai_consent_grant',
      args: {
        p_actor_id: OWNER,
        p_novel_id: 41,
        p_processor: 'openai',
        p_policy_revision: REVISION
      }
    }
  ]);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('revoke does not demand a new disclosure checkbox', async () => {
  const { actions, state } = fixture();
  await actions.grant(GRANT);
  const removed = await actions.revoke(REVOKE);
  assert.deepEqual(removed, {
    novelId: 41,
    processor: 'openai',
    status: 'revoked',
    aiEnabled: false
  });
  assert.equal(state.revoked, true);
  assert.equal(state.auth, 2);
  assert.equal(state.workReads, 2);
  assert.equal(state.writes.length, 2);
  await assert.rejects(
    actions.grant({ ...GRANT, explicitAuthorAction: false }),
    /AI_CONSENT_ACTION_DENIED/u
  );
  assert.equal(state.writes.length, 2);
});

test('revocation requires owner identity and explicit author action', async () => {
  const { actions, state } = fixture({ actor: OTHER });
  await assert.rejects(actions.revoke(REVOKE), /AI_CONSENT_ACTION_DENIED/u);
  assert.equal(state.writes.length, 0);
  await assert.rejects(
    actions.revoke({ ...REVOKE, explicitAuthorAction: false }),
    /AI_CONSENT_ACTION_DENIED/u
  );
  assert.equal(state.writes.length, 0);
});

test('RPC failures are sanitized and never claimed as successful consent', async () => {
  const { actions, state } = fixture({ rpcError: true });
  await assert.rejects(
    actions.grant(GRANT),
    (error) => error.message === 'AI_CONSENT_ACTION_UNAVAILABLE'
  );
  await assert.rejects(
    actions.revoke(REVOKE),
    (error) => error.message === 'AI_CONSENT_ACTION_UNAVAILABLE'
  );
  assert.equal(state.writes.length, 2);
});

test('missing trusted adapters cannot create a consent workflow', () => {
  assert.throws(
    () => createOwnerNovelBibleConsentActions({ enabled: true }),
    /AI_CONSENT_ACTION_UNAVAILABLE/u
  );
});
