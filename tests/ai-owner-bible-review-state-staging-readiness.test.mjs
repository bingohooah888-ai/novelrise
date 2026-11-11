import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { createSupabaseOwnerBibleReviewStateRepository } from '../api/_lib/ai/owner-bible-review-state-repository.js';
import { assessStagingMigrationRecovery } from '../scripts/audit-staging-migration-recovery.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-review-session-token-only';
const SQL = new URL(
  '../reports/sql/novelight_ai_owner_review_state_PROPOSAL.sql',
  import.meta.url
);
const PREFLIGHT = new URL(
  '../reports/sql/novelight_ai_owner_review_state_READONLY_PREFLIGHT.sql',
  import.meta.url
);
const ROLLBACK = new URL(
  '../reports/sql/novelight_ai_owner_review_state_ROLLBACK_PROPOSAL.sql',
  import.meta.url
);
const PLAN = new URL(
  '../docs/NOVELIGHT-AI-PHASE2-REVIEW-STATE-STAGING-READINESS.md',
  import.meta.url
);

function runnable(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function sessionFixture({
  changeOwnerDuringRead = false,
  missingRow = false
} = {}) {
  const calls = [];
  let currentOwner = OWNER;
  let active = true;
  const repository = createSupabaseOwnerBibleReviewStateRepository({
    checkSession: async ({ bearerToken, actorId, novelId }) => {
      calls.push('signed-session');
      if (
        !active ||
        bearerToken !== TOKEN ||
        actorId !== OWNER ||
        novelId !== 17
      ) {
        return null;
      }
      return { active: true, binding: SESSION };
    },
    serviceClient: {
      from(table) {
        calls.push('from:' + table);
        if (table === 'novels') {
          return {
            select(fields) {
              assert.equal(fields, 'id,user_id');
              return {
                eq(key, id) {
                  assert.equal(key, 'id');
                  assert.equal(id, 17);
                  return {
                    async maybeSingle() {
                      return {
                        data: { id: 17, user_id: currentOwner },
                        error: null
                      };
                    }
                  };
                }
              };
            }
          };
        }
        assert.equal(table, 'novelight_ai_owner_review_states');
        return {
          select(fields) {
            assert.equal(
              fields,
              'actor_id,novel_id,version,revision,reviewed_ids'
            );
            return this;
          },
          eq(key, value) {
            calls.push('scope:' + key + ':' + String(value));
            return this;
          },
          async maybeSingle() {
            if (changeOwnerDuringRead) currentOwner = FOREIGN;
            return {
              data: missingRow
                ? null
                : {
                    actor_id: OWNER,
                    novel_id: 17,
                    version: 1,
                    revision: 1,
                    reviewed_ids: ['rv1-abcdef0123456789']
                  },
              error: null
            };
          }
        };
      },
      async rpc() {
        throw new Error('not allowed in owner read test');
      }
    }
  });
  return {
    repository,
    calls,
    revoke: () => (active = false),
    changeOwner: () => (currentOwner = FOREIGN)
  };
}

const params = {
  actorId: OWNER,
  novelId: 17,
  bearerToken: TOKEN
};

test('owner state read double checks ownership after the private scoped snapshot', async () => {
  const f = sessionFixture();
  assert.equal((await f.repository.readSnapshot(params)).revision, 1);
  assert.deepEqual(f.calls, [
    'signed-session',
    'from:novelight_ai_owner_review_states',
    'scope:actor_id:' + OWNER,
    'scope:novel_id:17',
    'signed-session',
    'from:novels'
  ]);
});

test('owner transfer during the snapshot read rejects the result, no private IDs returned', async () => {
  const f = sessionFixture({ changeOwnerDuringRead: true });
  await assert.rejects(
    f.repository.readSnapshot(params),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
  assert.equal(f.calls.includes('from:novels'), true);
});

test('novel deletion or ownership transfer rejects even an empty snapshot', async () => {
  const f = sessionFixture({ missingRow: true });
  f.changeOwner();
  await assert.rejects(
    f.repository.readSnapshot(params),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
});

test('read-only Staging catalog precheck has no session-row query or grants', () => {
  const text = readFileSync(PREFLIGHT, 'utf8');
  const executable = runnable(text);
  assert.match(text, /NOT A MIGRATION\. DO NOT EXECUTE/);
  assert.match(executable, /with existing as \(/i);
  assert.match(executable, /to_regclass\('auth\.sessions'\)/);
  assert.match(
    executable,
    /has_schema_privilege\('service_role', 'auth', 'USAGE'\)/
  );
  assert.match(
    executable,
    /has_any_column_privilege\([\s\S]*'service_role', sessions_oid, 'UPDATE'/
  );
  assert.match(
    executable,
    /has_any_column_privilege\([\s\S]*'service_role', novels_oid, 'UPDATE'/
  );
  assert.match(
    executable,
    /has_function_privilege\('anon', cas_oid, 'EXECUTE'\)/
  );
  assert.match(
    executable,
    /has_function_privilege\('authenticated', cas_oid, 'EXECUTE'\)/
  );
  assert.doesNotMatch(executable, /\bfrom\s+auth\.sessions\s+[a-z_]+/i);
  assert.doesNotMatch(
    executable,
    /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate|repair)\s+\b/i
  );
});

test('installation proposal fails closed on unavailable FOR SHARE privilege', () => {
  const text = readFileSync(SQL, 'utf8');
  const program = runnable(text);
  const guard = program.indexOf('do $review_state_privilege_guard$');
  const table = program.indexOf(
    'create table public.novelight_ai_owner_review_states'
  );
  const func = program.indexOf(
    'create function public.novelight_ai_owner_review_state_cas'
  );
  assert.ok(guard > 0 && guard < table && table < func);
  assert.match(
    program,
    /has_column_privilege\('service_role', v_auth_sessions, 'id', 'SELECT'\)/
  );
  assert.match(
    program,
    /has_column_privilege\('service_role', v_auth_sessions, 'user_id', 'SELECT'\)/
  );
  assert.match(
    program,
    /has_any_column_privilege\('service_role', v_auth_sessions, 'UPDATE'\)/
  );
  assert.match(
    program,
    /has_any_column_privilege\('service_role', v_novels, 'UPDATE'\)/
  );
  assert.match(program, /raise exception using errcode = '42501'/);
  assert.doesNotMatch(program, /\bgrant\s+update\s+on\s+auth\.sessions/i);
  assert.doesNotMatch(program, /\bsecurity\s+definer\b/i);
});

test('rollback proposal aborts when nonempty; drops only exact Staging review objects without cascade', () => {
  const text = readFileSync(ROLLBACK, 'utf8');
  const program = runnable(text);
  assert.match(text, /NOT APPROVED for Production or Staging/);
  assert.match(
    program,
    /if exists \(select 1 from public\.novelight_ai_owner_review_states limit 1\)/
  );
  assert.match(
    program,
    /drop function public\.novelight_ai_owner_review_state_cas\(/
  );
  assert.match(
    program,
    /drop table public\.novelight_ai_owner_review_states restrict/
  );
  assert.doesNotMatch(program, /\bcascade\b/i);
  assert.doesNotMatch(program, /\bauth\.\w+\b/);
  assert.doesNotMatch(program, /\bsupabase_migrations\b/i);
});

test('existing recovery auditor blocks the known two-sided migration divergence (synthetic snapshot only)', () => {
  const assessment = assessStagingMigrationRecovery({
    localMigrations: [
      {
        name: '20261109173000_scout_point_future_rewards_10x.sql',
        sql: '-- synthetic'
      },
      {
        name: '20261110172000_author_reader_retention_cross_visit.sql',
        sql: '-- synthetic'
      }
    ],
    remoteVersions: ['20261109173000', '20261110080421'],
    checkNames: [],
    rollbackNames: []
  });
  assert.deepEqual(assessment.missingOnStaging, ['20261110172000']);
  assert.deepEqual(assessment.unexpectedOnStaging, ['20261110080421']);
  assert.equal(assessment.migrationParity, false);
  assert.equal(assessment.automaticRepairAllowed, false);
  assert.ok(
    assessment.blockers.includes('UNEXPECTED_STAGING_MIGRATION_HISTORY')
  );
  assert.ok(
    assessment.blockers.includes('MISSING_OR_AMBIGUOUS_SAFETY_ARTIFACTS')
  );
  assert.equal(
    existsSync(
      new URL(
        '../supabase/migrations/20261110172000_author_reader_retention_cross_visit.sql',
        import.meta.url
      )
    ),
    true
  );
});

test('Staging plan requires independent approval and two read-only checks, leaves API unmounted', () => {
  const plan = readFileSync(PLAN, 'utf8');
  assert.match(plan, /wmlzjgvxgoyrovdhbqbg/);
  assert.match(plan, /合計2回/);
  assert.match(plan, /Migration history/);
  assert.match(plan, /NO-GO/);
  assert.match(plan, /セッション/);
  assert.match(plan, /ROLLBACK_PROPOSAL/);
  assert.equal(
    existsSync(
      new URL('../api/ai-owner-bible-review-state.js', import.meta.url)
    ),
    false
  );
  const html = readFileSync(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    html,
    /novelight-ai-bible-owner-review-state-offline-http/
  );
});
