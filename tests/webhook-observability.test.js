import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isStripeSignatureVerificationError,
  webhookFailureLog
} from '../api/_lib/webhook-observability.js';

test('classifies Stripe signature verification failures without logging the signature', () => {
  const error = Object.assign(new Error('No signatures found matching'), {
    type: 'StripeSignatureVerificationError'
  });
  const req = {
    headers: {
      'stripe-signature': 't=1787817600,v1=secret-signature-value',
      'user-agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
      'x-vercel-id': 'hnd1::request-123',
      'content-length': '456'
    }
  };

  assert.equal(isStripeSignatureVerificationError(error), true);

  const result = webhookFailureLog(error, req);
  assert.equal(result.level, 'warn');
  assert.equal(result.message, 'Webhook signature verification failed');
  assert.deepEqual(result.details, {
    kind: 'signature_verification',
    hasStripeSignature: true,
    signatureTimestamp: '1787817600',
    userAgent: 'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
    vercelRequestId: 'hnd1::request-123',
    contentLength: '456'
  });
  assert.equal(
    JSON.stringify(result).includes('secret-signature-value'),
    false
  );
});

test('generic webhook processing errors retain actionable server details', () => {
  const error = Object.assign(new Error('database unavailable'), {
    name: 'Error',
    code: 'db_unavailable'
  });

  const result = webhookFailureLog(error, { headers: {} });
  assert.equal(result.level, 'error');
  assert.equal(result.details.kind, 'processing');
  assert.equal(result.details.code, 'db_unavailable');
  assert.equal(result.details.message, 'database unavailable');
});
