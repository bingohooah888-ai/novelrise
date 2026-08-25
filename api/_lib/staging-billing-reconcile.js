import { syncCustomerSubscription } from './stripe-webhook.js';

const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';

function getBearerToken(authorization) {
  const bearerMatch =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return bearerMatch?.[1] ?? null;
}

function stripeId(value) {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

function isSafePreviewEnvironment(env) {
  if (env.VERCEL_ENV !== 'preview') return false;
  if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) return false;

  try {
    const target = new globalThis.URL(env.SUPABASE_URL);
    return (
      target.protocol === 'https:' &&
      target.hostname.endsWith('.supabase.co') &&
      target.hostname !== PRODUCTION_SUPABASE_HOST
    );
  } catch {
    return false;
  }
}

async function getProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,stripe_customer_id')
    .eq('id', userId)
    .limit(1);

  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  return data?.[0] ?? null;
}

async function resolveCustomerId({ stripe, profile, userId, checkoutSessionId }) {
  if (!checkoutSessionId) {
    return profile.stripe_customer_id ?? null;
  }

  if (
    typeof checkoutSessionId !== 'string' ||
    !checkoutSessionId.startsWith('cs_test_')
  ) {
    const error = new Error('Invalid checkout session');
    error.statusCode = 400;
    throw error;
  }

  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const sessionUserId = session.metadata?.userId || session.client_reference_id;

  if (sessionUserId !== userId) {
    const error = new Error('Checkout session does not belong to the user');
    error.statusCode = 403;
    throw error;
  }

  if (session.mode !== 'subscription') {
    const error = new Error('Checkout session is not a subscription');
    error.statusCode = 409;
    throw error;
  }

  return stripeId(session.customer);
}

export function createStagingBillingReconcileHandler({
  stripe,
  supabase,
  env = process.env
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isSafePreviewEnvironment(env)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { data, error: authError } = await supabase.auth.getUser(token);
      const user = data?.user;

      if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const profile = await getProfile(supabase, user.id);
      if (!profile) {
        return res.status(409).json({ error: 'Author profile is not ready' });
      }

      const customerId = await resolveCustomerId({
        stripe,
        profile,
        userId: user.id,
        checkoutSessionId: req.body?.checkoutSessionId
      });

      if (!customerId) {
        return res.status(409).json({ error: 'Stripe customer is not ready' });
      }

      const result = await syncCustomerSubscription({
        stripe,
        supabase,
        customerId,
        userId: user.id,
        env
      });

      return res.status(200).json({ synced: true, result });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;

      console.error('Staging billing reconciliation failed', {
        name: error?.name,
        code: error?.code,
        message: error?.message
      });

      return res.status(statusCode).json({
        error:
          statusCode >= 500
            ? 'Staging billing reconciliation failed'
            : error.message
      });
    }
  };
}
