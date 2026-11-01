import assert from 'node:assert/strict';
import test from 'node:test';

import { create020705StagingCleanup } from '../.github/staging-ai-02-07-05/staging-synthetic-cleanup.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const SYNTHETIC = {
  supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
  projectRef: 'wmlzjgvxgoyrovdhbqbg',
  verifiedSynthetic: true,
  userId: USER,
  novelId: 41,
  approvalCommentId: 901
};

function fixture({ realUser = false, badCensus = false, failedDisable = false } = {}) {
  const calls = [];
  const serviceClient = {
    from(table) {
      const action = { table, operation: null, scopes: [], payload: null };
      const query = {
        select() {
          action.operation = 'select';
          return query;
        },
        update(payload) {
          action.operation = 'update';
          action.payload = payload;
          return query;
        },
        delete() {
          action.operation = 'delete';
          return query;
        },
        eq(key, value) {
          action.scopes.push([key, value]);
          return query;
        },
        async maybeSingle() {
          calls.push(action);
          return {
            data: { id: 41, user_id: USER },
            error: null
          };
        },
        then(resolve) {
          calls.push(action);
          resolve({ error: null });
        }
      };
      return query;
    }
  };
  const authAdmin = {
    async getUserById() {
      return {
        data: {
          user: {
            id: USER,
            email: realUser
              ? 'actual-person@example.com'
              : 'novelight-ai-020705-synthetic@example.test',
            app_metadata: { internal_e2e: !realUser }
          }
        },
        error: null
      };
    },
    async deleteUser(id) {
      calls.push({ action: 'deleteAuth', id });
      return { error: null };
    }
  };
  const census = {
    runtimeDisabledZero: true,
    approvalTombstoneCount: 1,
    users: 0,
    identities: 0,
    sessions: 0,
    profiles: 0,
    novels: 0,
    episodes: 0,
    facts: 0,
    analysis: 0,
    reviewCandidates: 0,
    consents: 0,
    consentAudit: 0,
    usageRequests: 0,
    usageAudit: 0
  };
  const cleanup = create020705StagingCleanup({
    serviceClient,
    authAdmin,
    synthetic: SYNTHETIC,
    disableTrialEnvironment: async () => {
      calls.push({ action: 'disableExternal' });
      return !failedDisable;
    },
    independentCensus: async () =>
      badCensus ? { ...census, sessions: 1 } : census
  });
  return { cleanup, calls };
}

test('stop attempts both Staging switch reset and external kill switch', async () => {
  const { cleanup, calls } = fixture();
  assert.equal(await cleanup.stop(), true);
  const settings = calls.find((call) =>
    call.table === 'novelight_ai_runtime_settings'
  );
  assert.equal(settings.operation, 'update');
  assert.deepEqual(settings.scopes, [['singleton', 1]]);
  assert.deepEqual(settings.payload, {
    enabled: false,
    user_day_cap_micros: 0,
    user_month_cap_micros: 0,
    global_day_cap_micros: 0,
    global_month_cap_micros: 0
  });
  assert.ok(calls.some((call) => call.action === 'disableExternal'));
});

test('external kill switch failure is reported even when DB reset succeeds', async () => {
  const { cleanup, calls } = fixture({ failedDisable: true });
  assert.equal(await cleanup.stop(), false);
  assert.ok(calls.some((call) => call.table === 'novelight_ai_runtime_settings'));
});

test('cleanup deletes only synthetic usage rows and the validated novel/user', async () => {
  const { cleanup, calls } = fixture();
  assert.equal(await cleanup.cleanup(), true);
  const deleted = calls.filter((c) => c.operation === 'delete');
  assert.equal(deleted.length, 5);
  assert.ok(deleted.every((c) => c.scopes.length > 0));
  assert.ok(deleted.some((c) =>
    c.table === 'novels' &&
    c.scopes.some(([key, value]) => key === 'user_id' && value === USER)
  ));
  assert.ok(!deleted.some((c) =>
    c.table === 'novelight_ai_020705_one_shot_claims'
  ));
  assert.ok(!deleted.some((c) =>
    c.table === 'novelight_ai_external_consent_action_audit'
  ));
  assert.ok(calls.some((c) => c.action === 'deleteAuth'));
});

test('real users are refused before any deletion', async () => {
  const { cleanup, calls } = fixture({ realUser: true });
  await assert.rejects(
    cleanup.cleanup(),
    /AI_020705_STAGING_CLEANUP_DENIED/u
  );
  assert.ok(!calls.some((c) => c.operation === 'delete'));
});

test('Production URL is refused and final census is independently mandatory', async () => {
  assert.throws(
    () => create020705StagingCleanup({
      synthetic: { ...SYNTHETIC, supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co' }
    }),
    /AI_020705_STAGING_CLEANUP_DENIED/u
  );
  const { cleanup } = fixture({ badCensus: true });
  await assert.rejects(
    cleanup.finalCensus(),
    /AI_020705_STAGING_CLEANUP_DENIED/u
  );
});
