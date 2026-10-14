// Safe background retry policy for NLO MASTER -> ChatGPT Project sync.
// A missing visible Project name is an identity failure, not permission
// to upload to an unverified destination.
export const MASTER_SYNC_RETRY_COOLDOWN_MS = 30 * 60 * 1000;

export function isMasterProjectIdentityMismatch(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.startsWith(
    'Opened ChatGPT page does not visibly identify Project '
  );
}

export function masterSyncRetryNotBefore(nowMs = Date.now()) {
  if (!Number.isFinite(nowMs)) {
    throw new Error('MASTER retry clock is invalid.');
  }
  return new Date(nowMs + MASTER_SYNC_RETRY_COOLDOWN_MS).toISOString();
}

export function shouldDeferMasterSyncAttempt(state, nowMs = Date.now()) {
  const status = String(state?.status || '');
  const retryable =
    status === 'error' ||
    status === 'login_required' ||
    status.startsWith('deferred_');
  if (!retryable || !Number.isFinite(nowMs)) return false;
  const deadline = Date.parse(String(state?.retryNotBeforeAt || ''));
  return Number.isFinite(deadline) && nowMs < deadline;
}
