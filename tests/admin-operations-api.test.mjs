import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdminAnnouncementsHandler,
  createAdminInquiriesHandler,
  createOperationsSummaryHandler
} from '../api/_lib/admin-operations.js';
import { createAdminReportsHandler } from '../api/_lib/admin-reports.js';
import { createPublishedAnnouncementsHandler } from '../api/_lib/public-announcements.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createSupabase(user = { id: ADMIN_ID, email: 'owner@example.com' }) {
  return {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return { data: { user }, error: null };
      }
    }
  };
}

function adminRequest(overrides = {}) {
  return {
    method: overrides.method ?? 'GET',
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...overrides.headers
    },
    query: { ...overrides.query },
    body: overrides.body
  };
}

async function run(handler, req) {
  const res = createResponse();
  await handler(req, res);
  return res;
}

test('operations summary requires an allowlisted authenticated admin', async () => {
  let loaded = false;
  const handler = createOperationsSummaryHandler({
    supabase: createSupabase({ id: OTHER_ID, email: 'reader@example.com' }),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadSummary: async () => {
      loaded = true;
      return {};
    }
  });

  const res = await run(handler, adminRequest());
  assert.equal(res.statusCode, 403);
  assert.equal(loaded, false);
  assert.match(String(res.headers.get('cache-control')), /no-store/);
});

test('operations summary returns only aggregate operational counts', async () => {
  const handler = createOperationsSummaryHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadSummary: async () => ({
      pendingReports: 2,
      pendingInquiries: 3,
      publishedAnnouncements: 4
    })
  });

  const res = await run(handler, adminRequest());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.operations, {
    pendingReports: 2,
    pendingInquiries: 3,
    publishedAnnouncements: 4
  });
  assert.equal(JSON.stringify(res.body).includes('email'), false);
  assert.equal(JSON.stringify(res.body).includes('message'), false);
  assert.equal(JSON.stringify(res.body).includes('details'), false);
});

test('announcement writes bind the authenticated admin id on the server', async () => {
  let createArgs;
  let updateArgs;
  const handler = createAdminAnnouncementsHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    listAnnouncements: async () => [],
    createAnnouncement: async (...args) => {
      createArgs = args;
      return { id: 1, status: 'draft' };
    },
    updateAnnouncement: async (...args) => {
      updateArgs = args;
      return { id: 1, status: 'published' };
    }
  });

  const created = await run(
    handler,
    adminRequest({
      method: 'POST',
      body: { title: '障害情報', body: '復旧しました。', category: '障害', status: 'draft' }
    })
  );
  assert.equal(created.statusCode, 201);
  assert.equal(createArgs[1], ADMIN_ID);
  assert.equal(createArgs[2].title, '障害情報');

  const updated = await run(
    handler,
    adminRequest({
      method: 'PATCH',
      body: {
        id: 1,
        title: '障害情報',
        body: '復旧しました。',
        category: '障害',
        status: 'published'
      }
    })
  );
  assert.equal(updated.statusCode, 200);
  assert.equal(updateArgs[1], ADMIN_ID);
  assert.equal(updateArgs[2], 1);
});

test('inquiry list omits sensitive fields until an explicit detail request', async () => {
  let detailCalls = 0;
  const handler = createAdminInquiriesHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    listInquiries: async () => [
      { id: 7, subject: '課金・解約', status: 'new', created_at: '2026-09-03T00:00:00Z' }
    ],
    getInquiry: async (supabase, id) => {
      detailCalls += 1;
      assert.equal(id, 7);
      return {
        id: 7,
        email: 'author@example.com',
        subject: '課金・解約',
        message: '確認したいことがあります。',
        status: 'new',
        user_id: OTHER_ID
      };
    },
    setStatus: async () => ({ id: 7, status: 'resolved' })
  });

  const list = await run(handler, adminRequest());
  assert.equal(list.statusCode, 200);
  assert.equal(detailCalls, 0);
  assert.equal(JSON.stringify(list.body).includes('author@example.com'), false);
  assert.equal(JSON.stringify(list.body).includes('確認したいことがあります。'), false);

  const detail = await run(handler, adminRequest({ query: { id: '7' } }));
  assert.equal(detail.statusCode, 200);
  assert.equal(detailCalls, 1);
  assert.equal(detail.body.inquiry.email, 'author@example.com');
});

test('inquiry status changes bind the admin id and reject malformed ids', async () => {
  let statusArgs;
  const handler = createAdminInquiriesHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    listInquiries: async () => [],
    getInquiry: async () => null,
    setStatus: async (...args) => {
      statusArgs = args;
      return { id: 9, status: 'reviewing' };
    }
  });

  const invalid = await run(
    handler,
    adminRequest({ method: 'PATCH', body: { id: 'not-an-id', status: 'reviewing' } })
  );
  assert.equal(invalid.statusCode, 400);

  const changed = await run(
    handler,
    adminRequest({ method: 'PATCH', body: { id: 9, status: 'reviewing' } })
  );
  assert.equal(changed.statusCode, 200);
  assert.equal(statusArgs[1], ADMIN_ID);
  assert.equal(statusArgs[2], 9);
  assert.equal(statusArgs[3], 'reviewing');
});

test('reports management exposes only triage summaries through an admin endpoint', async () => {
  const handler = createAdminReportsHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadReports: async () => [
      {
        id: '30000000-0000-4000-8000-000000000001',
        novel_id_snapshot: 'novel-1',
        episode_id_snapshot: null,
        category: 'spam',
        status: 'new',
        created_at: '2026-09-03T00:00:00Z'
      }
    ]
  });

  const res = await run(handler, adminRequest());
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes('reporter_id'), false);
  assert.equal(JSON.stringify(res.body).includes('visitor_key_hash'), false);
  assert.equal(JSON.stringify(res.body).includes('details'), false);
});

test('public announcements API is GET-only and exposes loader output without admin data', async () => {
  const handler = createPublishedAnnouncementsHandler({
    supabase: {},
    loadAnnouncements: async () => [
      {
        id: 1,
        title: 'β版のお知らせ',
        body: '公開本文',
        category: '運営',
        published_at: '2026-09-03T00:00:00Z'
      }
    ],
    clock: () => new Date('2026-09-03T01:00:00Z')
  });

  const get = await run(handler, { method: 'GET' });
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.announcements.length, 1);
  assert.equal(JSON.stringify(get.body).includes('admin_user_id'), false);

  const post = await run(handler, { method: 'POST' });
  assert.equal(post.statusCode, 405);
});
