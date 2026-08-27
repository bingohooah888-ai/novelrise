function header(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value ? value : null;
}

function signatureTimestamp(signature) {
  if (typeof signature !== 'string') return null;
  const match = signature.match(/(?:^|,)t=(\d+)(?:,|$)/);
  return match?.[1] ?? null;
}

export function isStripeSignatureVerificationError(error) {
  return error?.type === 'StripeSignatureVerificationError';
}

export function webhookFailureLog(error, req) {
  if (isStripeSignatureVerificationError(error)) {
    const signature = header(req, 'stripe-signature');
    return {
      level: 'warn',
      message: 'Webhook signature verification failed',
      details: {
        kind: 'signature_verification',
        hasStripeSignature: Boolean(signature),
        signatureTimestamp: signatureTimestamp(signature),
        userAgent: header(req, 'user-agent'),
        vercelRequestId: header(req, 'x-vercel-id'),
        contentLength: header(req, 'content-length')
      }
    };
  }

  return {
    level: 'error',
    message: 'Webhook processing failed',
    details: {
      kind: 'processing',
      name: error?.name,
      type: error?.type,
      code: error?.code,
      message: error?.message
    }
  };
}
