import { createHash } from 'node:crypto';

function fingerprint(parts) {
  const digest = createHash('sha256')
    .update(parts.map((part) => String(part)).join('\n'))
    .digest('hex');
  return `sha256:${digest}`;
}

export function repairCandidateFingerprint(candidate) {
  if (!candidate?.profileId || !candidate?.stripeCustomerId) {
    throw new Error('Repair candidate fingerprint requires immutable identifiers');
  }

  return fingerprint([
    'novelight-production-billing-repair-v1',
    candidate.profileId,
    candidate.stripeCustomerId
  ]);
}

export function legacyWebhookFingerprint(endpointIds) {
  const ids = [...new Set((endpointIds || []).map(String))].sort();
  if (ids.length === 0) return null;

  return fingerprint(['novelight-production-webhook-cleanup-v1', ...ids]);
}
