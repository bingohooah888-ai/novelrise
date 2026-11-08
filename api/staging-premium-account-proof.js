import { createHash, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';

// Preview-only, read-only identity attestation: never returns customer,
// account, key, or subscription identifiers. Production is always 404.
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const SHA = /^[a-f0-9]{64}$/u;

export async function attestPremiumStagingAccount({
  env,
  expectedSha256,
  retrieveAccount
}) {
  if (
    env?.VERCEL_ENV !== 'preview' ||
    env?.SUPABASE_URL !== STAGING ||
    !/^sk_test_[A-Za-z0-9_]{12,}$/u.test(env?.STRIPE_SECRET_KEY || '') ||
    !SHA.test(expectedSha256 || '') ||
    typeof retrieveAccount !== 'function'
  )
    throw new Error('STAGING_PROOF_DENIED');

  const account = await retrieveAccount();
  if (
    typeof account?.id !== 'string' ||
    !/^acct_[A-Za-z0-9]+$/u.test(account.id)
  )
    throw new Error('STAGING_PROOF_DENIED');

  const actual = createHash('sha256').update(account.id, 'utf8').digest();
  if (!timingSafeEqual(actual, Buffer.from(expectedSha256, 'hex')))
    throw new Error('STAGING_PROOF_DENIED');
  return { accountMatch: true };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const proof = await attestPremiumStagingAccount({
      env: process.env,
      expectedSha256: req.headers['x-novelight-expected-account-sha256'],
      retrieveAccount: () => stripe.accounts.retrieve()
    });
    return res.status(200).json(proof);
  } catch {
    // No API response ever contains a Stripe account identifier or key.
    return res.status(403).json({ error: 'STAGING_PROOF_DENIED' });
  }
}
