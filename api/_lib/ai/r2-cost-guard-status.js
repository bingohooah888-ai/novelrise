import { costGuardDisplay, evaluateR2CostGuard } from './r2-cost-guard.js';

const PATH = '/internal/novelight-cost-guard/status';
const UNVERIFIED = Object.freeze({
  state: 'unverified',
  severity: 'critical',
  stopRequired: true,
  stopConfirmed: false,
  admissionPermitted: false
});

function providerUrl(value) {
  try {
    const url = new globalThis.URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.workers.dev') ||
      url.pathname !== PATH ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function publicStatus(result) {
  const display = costGuardDisplay(result);
  return {
    state: result.state,
    severity: result.severity,
    stopRequired: result.stopRequired,
    stopConfirmed: result.stopConfirmed,
    admissionPermitted: result.admissionPermitted,
    maxPercent: result.maxPercent ?? null,
    observedAt: result.observedAt ?? null,
    title: display.title,
    detail: display.detail
  };
}

export async function loadR2CostGuardStatus({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now()
} = {}) {
  const endpoint = env.NOVELIGHT_CF_R2_COST_GUARD_STATUS_URL;
  const token = env.NOVELIGHT_CF_R2_COST_GUARD_STATUS_TOKEN;
  if (!endpoint && !token) {
    return {
      state: 'not-configured',
      severity: 'warning',
      stopRequired: true,
      stopConfirmed: false,
      admissionPermitted: false,
      maxPercent: null,
      observedAt: null,
      title: 'AIコストガード：監視は未接続',
      detail:
        'R2の使用量監視・自動停止は実環境で未有効です。AIの有料処理は承認できません。'
    };
  }
  const url = providerUrl(endpoint);
  if (!url || typeof token !== 'string' || token.length < 32) {
    return publicStatus(UNVERIFIED);
  }

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(4000)
    });
    if (!response?.ok) return publicStatus(UNVERIFIED);
    const raw = await response.text();
    if (raw.length > 16000) return publicStatus(UNVERIFIED);
    const snapshot = JSON.parse(raw);
    return publicStatus(evaluateR2CostGuard(snapshot, { now }));
  } catch {
    // Never log the endpoint URL, Authorization value, response body or token.
    return publicStatus(UNVERIFIED);
  }
}
