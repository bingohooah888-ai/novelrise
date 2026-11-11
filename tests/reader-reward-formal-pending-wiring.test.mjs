import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';

const root = new URL('../docs/plans/', import.meta.url);
const functionsSql = readFileSync(
  new URL('SCOUT-FORMAL-EARNINGS-FUNCTIONS-PENDING-20261111.sql', root),
  'utf8'
);
const triggersSql = readFileSync(
  new URL('SCOUT-FORMAL-EARNINGS-TRIGGERS-PENDING-20261111.sql', root),
  'utf8'
);
const names = [
  'credit_confirmed_formal_point_draft',
  'award_read_points_draft',
  'award_comment_points_draft',
  'review_comment_and_award_draft',
  'enqueue_earning_draft',
  'decide_earning_review_draft',
  'claim_earning_draft',
  'finish_earning_draft',
  'on_valid_read_formal_draft',
  'on_episode_comment_formal_draft'
];

test('unpublished SQL prepares existing 10 private function bodies but never installs triggers', () => {
  const found = [
    ...functionsSql.matchAll(
      /^create or replace function novelight_formal_private\.([a-z_]+)\(/gm
    )
  ].map((x) => x[1]);
  assert.deepEqual(found, names);
  assert.equal(
    (functionsSql.match(/^revoke all on function /gm) || []).length,
    10
  );
  assert.doesNotMatch(functionsSql, /^\s*create trigger\s/im);
  assert.doesNotMatch(functionsSql, /^\s*grant\s/im);
  assert.doesNotMatch(
    functionsSql,
    /^\s*(create table|alter table|create trigger|grant)\s/im
  );
  assert.match(functionsSql, /where user_id=v_read\.reader_id for update/);
  assert.match(functionsSql, /formal_comment_reward/);
  assert.match(functionsSql, /credit_confirmed_formal_point_draft/);
});

test('trigger activation isolated in a separate, explicitly unapproved SQL file', () => {
  assert.equal((triggersSql.match(/^create trigger /gm) || []).length, 2);
  assert.match(triggersSql, /create trigger scout_formal_read_level_capture/);
  assert.match(triggersSql, /create trigger scout_formal_comment_enqueue/);
  assert.doesNotMatch(
    triggersSql,
    /^\s*(create or replace function|create table|insert into|update public\.)\s/im
  );
  assert.equal(
    (triggersSql.match(/^grant execute on function /gm) || []).length,
    10
  );
});

test('application host exposes the existing reader/admin APIs and opening sync, without live I/O', async () => {
  const queryCalls = [];
  const app = createUnregisteredFormalApplication({
    pool: {
      query: async () => {
        queryCalls.push('query');
        return { rows: [] };
      },
      connect: async () => {
        throw Error('UNAPPROVED_DB_CONNECT');
      }
    },
    supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
    releaseTimestampIso: '2026-11-01T00:00:00.000Z',
    unitVerification: {}, // prevents opening/Point operations
    releaseConfiguration: {
      formalRewardsEnabled: false,
      formalEarningsEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {
      serviceRoleVerified: false,
      verifiedByTrustedServer: false
    }
  });
  assert.equal(queryCalls.length, 0);
  assert.equal(typeof app.readerHttp, 'function');
  assert.equal(typeof app.adminHttp, 'function');
  assert.equal(
    (await app.inspectFormalOpening('11111111-1111-4111-8111-111111111111'))
      .status,
    'point_cutover_unverified_hold'
  );
  assert.equal(
    (
      await app.initializeFormalOpening(
        '11111111-1111-4111-8111-111111111111',
        {}
      )
    ).status,
    'point_cutover_unverified_hold'
  );
  assert.equal(queryCalls.length, 0);
  const api = app.createApiDispatch({
    readerPath: '/api/scout-formal-reader',
    adminPath: '/api/scout-formal-admin'
  });
  assert.equal(api.routes.reader, '/api/scout-formal-reader');
  assert.equal(api.routes.admin, '/api/scout-formal-admin');
  const res = {
    status(c) {
      this.code = c;
      return this;
    },
    json(v) {
      this.payload = v;
      return this;
    }
  };
  await api.dispatch({ url: '/not-registered' }, res);
  assert.equal(res.code, 404);
  assert.equal(queryCalls.length, 0);
});
