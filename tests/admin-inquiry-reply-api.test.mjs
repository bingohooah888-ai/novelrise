import assert from 'node:assert/strict';
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
  return {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return {
          data: { user: { id: ADMIN_ID, email: 'owner@example.com' } },
          error: null
        };
      }
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
  const handler = createAdminInquiryReplyHandler({
    supabase: createSupabase(),
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
});
