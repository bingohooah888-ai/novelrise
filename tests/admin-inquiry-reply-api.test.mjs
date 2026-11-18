import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

import { createAdminInquiryReplyHandler } from '../api/_lib/admin-inquiry-reply.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

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

function createSupabase() {
  const auditRows = [];
  return {
    auditRows,
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return {
          data: { user: { id: ADMIN_ID, email: 'owner@example.com' } },
          error: null
        };
      }
    },
    from(table) {
      assert.equal(table, 'admin_inquiry_replies');
      return {
        insert(row) {
          const saved = { ...row, id: auditRows.length + 1 };
          auditRows.push(saved);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: saved.id }, error: null };
                }
              };
            }
          };
        },
        update(values) {
          return {
            async eq(column, id) {
              assert.equal(column, 'id');
              Object.assign(
                auditRows.find((row) => row.id === id),
                values
              );
              return { error: null };
            }
          };
        },
        select() {
          return {
            eq(column, id) {
              assert.equal(column, 'inquiry_id');
              return {
                order() {
                  return {
                    async limit() {
                      return {
                        data: auditRows.filter((row) => row.inquiry_id === id),
                        error: null
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

function request(body) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    },
    body
  };
}

async function run(handler, req) {
  const res = createResponse();
  await handler(req, res);
  return res;
}

test('admin inquiry reply sends only to the server-side inquiry address and resolves after delivery', async () => {
  let deliveryArgs;
  let resolvedArgs;
  const handler = createAdminInquiryReplyHandler({
    supabase: createSupabase(),
    env: {
      NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID,
      RESEND_API_KEY: 'test-resend-key'
    },
    getInquiry: async (_supabase, id) => {
      assert.equal(id, 27);
      return {
        id: 27,
        email: 'author@example.com',
        subject: '特定商取引法に基づく表示事項の開示請求',
        status: 'reviewing'
      };
    },
    sendReply: async (args) => {
      deliveryArgs = args;
      return { id: 'resend-message-id' };
    },
    setResolved: async (...args) => {
      resolvedArgs = args;
      return { id: 27, status: 'resolved' };
    }
  });

  const res = await run(
    handler,
    request({
      id: 27,
      to: 'attacker@example.com',
      subject: '【NOVELIGHT】お問い合わせへの回答',
      message: '回答本文です。'
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(deliveryArgs.to, 'author@example.com');
  assert.equal(deliveryArgs.subject, '【NOVELIGHT】お問い合わせへの回答');
  assert.equal(deliveryArgs.message, '回答本文です。');
  assert.equal(resolvedArgs[1], ADMIN_ID);
  assert.equal(resolvedArgs[2], 27);
  assert.equal(res.body.inquiry.status, 'resolved');
  assert.equal(res.body.delivery.id, 'resend-message-id');
});

test('admin inquiry reply uses the support sender address', async () => {
  let resendRequest;
  const handler = createAdminInquiryReplyHandler({
    supabase: createSupabase(),
    env: {
      NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID,
      RESEND_API_KEY: 'test-resend-key'
    },
    fetchImpl: async (url, init) => {
      resendRequest = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend-support-id' })
      };
    },
    getInquiry: async () => ({
      id: 28,
      email: 'author@example.com',
      status: 'reviewing'
    }),
    setResolved: async () => ({ id: 28, status: 'resolved' })
  });

  const res = await run(
    handler,
    request({
      id: 28,
      subject: '【NOVELIGHT】お問い合わせへの回答',
      message: '回答本文です。'
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(resendRequest.url, 'https://api.resend.com/emails');
  const payload = JSON.parse(resendRequest.init.body);
  assert.equal(payload.from, 'NOVELIGHT <support@novelight.jp>');
  assert.deepEqual(payload.to, ['author@example.com']);
});

test('admin inquiry reply rejects malformed payload before delivery', async () => {
  let sent = false;
  const handler = createAdminInquiryReplyHandler({
    supabase: createSupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    getInquiry: async () => ({ id: 1, email: 'author@example.com' }),
    sendReply: async () => {
      sent = true;
      return { id: 'should-not-send' };
    },
    setResolved: async () => ({ id: 1, status: 'resolved' })
  });

  const res = await run(
    handler,
    request({ id: 'bad-id', subject: '', message: '' })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(sent, false);
});

test('admin inquiry reply does not resolve when email delivery fails', async () => {
  let resolved = false;
  const supabase = createSupabase();
  const handler = createAdminInquiryReplyHandler({
    supabase,
    env: {
      NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID,
      RESEND_API_KEY: 'test-resend-key'
    },
    getInquiry: async () => ({
      id: 8,
      email: 'author@example.com',
      status: 'new'
    }),
    sendReply: async () => {
      const error = new Error('rejected');
      error.code = 'RESEND_REJECTED';
      error.httpStatus = 422;
      throw error;
    },
    setResolved: async () => {
      resolved = true;
      return { id: 8, status: 'resolved' };
    }
  });

  const res = await run(
    handler,
    request({
      id: 8,
      subject: '【NOVELIGHT】お問い合わせへの回答',
      message: '回答本文です。'
    })
  );

  assert.equal(res.statusCode, 502);
  assert.equal(resolved, false);
  assert.equal(supabase.auditRows[0].status, 'failed');
});

test('reply history is available only through the authenticated ADMIN handler', async () => {
  const supabase = createSupabase();
  supabase.auditRows.push({
    id: 1,
    inquiry_id: 27,
    subject: '先の返信',
    message: '保存された本文',
    status: 'sent',
    sent_at: '2026-11-18T10:00:00Z'
  });
  const handler = createAdminInquiryReplyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    getInquiry: async (_db, id) => ({ id, email: 'author@example.com' })
  });
  const req = request();
  req.method = 'GET';
  req.query = { id: '27' };
  const response = await run(handler, req);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.replies[0].message, '保存された本文');
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0'
  );

  const denied = request();
  denied.method = 'GET';
  denied.query = { id: '27' };
  delete denied.headers.authorization;
  const unauthorized = await run(handler, denied);
  assert.equal(unauthorized.statusCode, 401);
});

test('email is not sent if the private reply audit cannot be created', async () => {
  let delivered = false;
  const supabase = createSupabase();
  supabase.from = () => ({
    insert() {
      return {
        select() {
          return {
            async single() {
              return { data: null, error: new Error('audit unavailable') };
            }
          };
        }
      };
    }
  });
  const handler = createAdminInquiryReplyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    getInquiry: async () => ({ id: 27, email: 'author@example.com' }),
    sendReply: async () => {
      delivered = true;
      return { id: 'unexpected' };
    }
  });
  const response = await run(
    handler,
    request({ id: 27, subject: '題名', message: '本文' })
  );
  assert.equal(response.statusCode, 500);
  assert.equal(delivered, false);
});

test('ambiguous delivery transport failure keeps reply status unconfirmed', async () => {
  const supabase = createSupabase();
  let resolved = false;
  const handler = createAdminInquiryReplyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID, RESEND_API_KEY: 'test-key' },
    getInquiry: async () => ({ id: 27, email: 'author@example.com' }),
    fetchImpl: async () => {
      throw new TypeError('network disconnected after submission');
    },
    setResolved: async () => {
      resolved = true;
    }
  });
  const response = await run(
    handler,
    request({ id: 27, subject: '件名', message: '返信本文' })
  );
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.deliveryStatus, 'unknown');
  assert.match(response.body.error, /再送しないでください/);
  assert.equal(supabase.auditRows.length, 1);
  assert.equal(supabase.auditRows[0].status, 'sending');
  assert.equal(resolved, false);
});

test('ambiguous Resend responses never mark an email as failed', async () => {
  for (const { status, ok, body } of [
    { status: 200, ok: true, body: {} },
    { status: 500, ok: false, body: { message: 'gateway error' } },
    { status: 429, ok: false, body: { message: 'rate limit' } }
  ]) {
    const supabase = createSupabase();
    const handler = createAdminInquiryReplyHandler({
      supabase,
      env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID, RESEND_API_KEY: 'test-key' },
      getInquiry: async () => ({ id: 27, email: 'author@example.com' }),
      fetchImpl: async () => ({ status, ok, json: async () => body })
    });
    const response = await run(
      handler,
      request({ id: 27, subject: '件名', message: '返信本文' })
    );
    assert.equal(response.statusCode, 503, 'HTTP ' + status);
    assert.equal(response.body.deliveryStatus, 'unknown');
    assert.equal(supabase.auditRows[0].status, 'sending');
  }
});

test('reply send success is not presented as a failure when list reload throws', async () => {
  const html = readFileSync(
    new URL('../admin-inquiries.html', import.meta.url),
    'utf8'
  );
  const begin = html.indexOf('  async function sendReply(');
  const end = html.indexOf("\n  document.getElementById('filters')", begin);
  assert.ok(begin > 0 && end > begin, 'reply UI function was found');
  const statusEl = { className: '', textContent: '' };
  const sendReply = runInNewContext(html.slice(begin, end) + '\nsendReply;', {
    statusEl,
    window: { confirm: () => true },
    console: { error: () => {} },
    adminFetch: async () => ({ inquiry: { id: 27, status: 'resolved' } }),
    loadList: async () => {
      throw new Error('list refresh failed');
    },
    openDetail: async () => {
      throw new Error('detail refresh failed');
    }
  });
  const button = { disabled: false };
  await sendReply(27, { value: '件名' }, { value: '返信本文' }, button);
  assert.equal(button.disabled, false);
  assert.match(statusEl.textContent, /返信メールを送信し/);
  assert.match(statusEl.textContent, /画面の再読み込みに失敗/);
  assert.doesNotMatch(statusEl.textContent, /送信できませんでした/);
});
