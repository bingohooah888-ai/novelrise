// Read-only, invoice-aware cost calculation; never grants resource creation.
// USD quote is not an invoice and excludes other compute, storage or builds.
const ID = /^[1-9][0-9]*$/u;
function deny() {
  throw new Error('COMMUNITY_HOSTED_COST_REPORT_DENIED');
}
function instant(value) {
  if (typeof value !== 'string') deny();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) deny();
  return parsed.getTime();
}
function invoice(input, provider) {
  if (!input || input.provider !== provider ||
      !['pending', 'final'].includes(input.status)) deny();
  if (input.status === 'pending') {
    if (input.amountMicros !== undefined || input.reference !== undefined) deny();
    return { provider, status: 'pending', amountUsd: null };
  }
  if (input.source !== 'provider-finalized-statement' ||
      input.currency !== 'USD' ||
      !Number.isSafeInteger(input.amountMicros) ||
      input.amountMicros < 0 ||
      !/^[A-Za-z0-9._:-]{6,128}$/u.test(input.reference ?? '')) deny();
  return {
    provider,
    status: 'final',
    reference: input.reference,
    amountUsd: (input.amountMicros / 1_000_000).toFixed(6)
  };
}
export function summarizeCommunityHostedCost({
  runId,
  startedAt,
  deletedAt = null,
  branchDeletionVerified,
  supabaseHourlyUsd,
  supabaseInvoice,
  vercelInvoice
}) {
  if (!ID.test(String(runId)) ||
      typeof branchDeletionVerified !== 'boolean') deny();
  const start = instant(startedAt);
  const end = deletedAt === null ? null : instant(deletedAt);
  if (end !== null && end < start) deny();
  if (typeof supabaseHourlyUsd !== 'number' ||
      !Number.isFinite(supabaseHourlyUsd) ||
      supabaseHourlyUsd <= 0 || supabaseHourlyUsd > 1) deny();
  const billing = [
    invoice(supabaseInvoice, 'supabase'),
    invoice(vercelInvoice, 'vercel')
  ];
  const elapsedHours = end === null ? null : (end - start) / 3_600_000;
  const quote = elapsedHours === null
    ? null : (elapsedHours * supabaseHourlyUsd).toFixed(6);
  const final = branchDeletionVerified && end !== null &&
    billing.every((item) => item.status === 'final');
  const totalFinalUsd = final
    ? (Number(billing[0].amountUsd) + Number(billing[1].amountUsd)).toFixed(6)
    : null;
  return Object.freeze({
    status: final
      ? 'FINAL_PROVIDER_STATEMENTS_AND_DELETION_VERIFIED'
      : 'PENDING_FINAL_BILLS_OR_DELETION',
    runId: String(runId),
    elapsedHours,
    supabaseQuotedComputeUsd: quote,
    estimateIsNotAnInvoice: true,
    branchDeletionVerified,
    billing,
    totalFinalUsd,
    fxConversionApplied: false
  });
}
