import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function bearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function activationConflict(message) {
  return new Set([
    'beta_standard_premium_active',
    'beta_standard_paid_subscription_requires_sync',
    'beta_standard_entitled_subscription_exists'
  ]).has(message);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = bearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase.rpc('novelight_activate_beta_standard', {
    p_user_id: authData.user.id
  });

  if (error) {
    if (activationConflict(error.message)) {
      return res.status(409).json({
        error: 'Billing account needs synchronization',
        code: 'billing_state_conflict'
      });
    }

    console.error('Beta Standard activation failed', {
      code: error.code || null,
      message: error.message || null
    });
    return res.status(500).json({ error: 'Beta Standard activation failed' });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.plan !== 'standard' || row?.payment_status !== 'beta_free') {
    console.error('Beta Standard activation returned unexpected state');
    return res.status(500).json({ error: 'Beta Standard activation failed' });
  }

  return res.status(200).json({
    plan: 'standard',
    paymentStatus: 'beta_free',
    mode: 'beta_free'
  });
}
