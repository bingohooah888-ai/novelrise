// A read-only decision engine for NOVELIGHT's proposed R2 cost guard.
// IMPORTANT: this is not a Cloudflare quota or a deployed admission gate.
// No new R2 operations may be authorized from this result until an atomic,
// durable, account-wide R2 admission controller has been independently proven.
export const R2_FREE_ALLOWANCE = Object.freeze({
  storageGbMonth: 10,
  classAOperations: 1_000_000,
  classBOperations: 10_000_000
});

export const R2_COST_GUARD_THRESHOLDS = Object.freeze({
  notice: 0.7,
  urgent: 0.85,
  stop: 0.9
});

const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const METRICS = Object.keys(R2_FREE_ALLOWANCE);

function isNonnegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function notVerified(reason) {
  return {
    state: 'unverified',
    reason,
    severity: 'critical',
    stopRequired: true,
    stopConfirmed: false,
    admissionPermitted: false,
    maxPercent: null,
    limitingMetric: null,
    metrics: null,
    observedAt: null
  };
}

export function evaluateR2CostGuard(snapshot, { now = Date.now() } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return notVerified('R2_USAGE_MISSING');
  }
  if (
    snapshot.source !== 'cloudflare-r2-account' ||
    snapshot.scope !== 'account'
  ) {
    return notVerified('ACCOUNT_COVERAGE_UNVERIFIED');
  }
  if (snapshot.storageClass !== 'STANDARD') {
    return notVerified('NON_STANDARD_STORAGE_UNVERIFIED');
  }
  const start = Date.parse(snapshot.billingPeriodStart);
  const end = Date.parse(snapshot.billingPeriodEnd);
  const observedAt = Date.parse(snapshot.observedAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(observedAt) ||
    start >= end ||
    end - start > 35 * 86400_000 ||
    now < start ||
    now >= end ||
    observedAt < start ||
    observedAt > now + MAX_CLOCK_SKEW_MS ||
    now - observedAt > MAX_SNAPSHOT_AGE_MS
  ) {
    return notVerified('R2_USAGE_STALE_OR_PERIOD_UNVERIFIED');
  }

  const usage = snapshot.usage;
  if (
    !usage ||
    METRICS.some((metric) => !isNonnegativeFinite(usage[metric])) ||
    !Number.isSafeInteger(usage.classAOperations) ||
    !Number.isSafeInteger(usage.classBOperations)
  ) {
    return notVerified('R2_USAGE_INVALID');
  }

  // A dashboard metric is not proof of enforcement. Only a verified,
  // fail-closed, atomic admission gate may claim a stopped state.
  const enforcement = snapshot.enforcement;
  if (
    enforcement?.allAccountR2OperationsCovered !== true ||
    enforcement?.durableAtomicStopVerified !== true ||
    !['running', 'stopped'].includes(enforcement?.state)
  ) {
    return notVerified('R2_ADMISSION_NOT_VERIFIED');
  }

  const metrics = Object.fromEntries(
    METRICS.map((name) => {
      const used = usage[name];
      const allowance = R2_FREE_ALLOWANCE[name];
      return [name, { used, allowance, percent: (used / allowance) * 100 }];
    })
  );
  const [limitingMetric, highest] = Object.entries(metrics).sort(
    (a, b) => b[1].percent - a[1].percent
  )[0];
  const maxPercent = highest.percent;
  const stopRequired = maxPercent >= R2_COST_GUARD_THRESHOLDS.stop * 100;
  const stopConfirmed = enforcement.state === 'stopped';

  // No automatic reset on a new billing month: restarting requires
  // separately authorized operator action.
  let state = 'normal';
  let severity = 'info';
  if (stopConfirmed) {
    state = 'stopped';
    severity = 'critical';
  } else if (stopRequired) {
    state = 'stop-required';
    severity = 'critical';
  } else if (maxPercent >= R2_COST_GUARD_THRESHOLDS.urgent * 100) {
    state = 'urgent';
    severity = 'warning';
  } else if (maxPercent >= R2_COST_GUARD_THRESHOLDS.notice * 100) {
    state = 'notice';
    severity = 'warning';
  }

  return {
    state,
    reason: null,
    severity,
    stopRequired: stopRequired || stopConfirmed,
    stopConfirmed,
    // This is a policy decision, NOT an admission token. Actual writes
    // must pass an atomic reservation before any R2 billable operation.
    admissionPermitted: !stopRequired && !stopConfirmed,
    maxPercent: Math.round(maxPercent * 10) / 10,
    limitingMetric,
    metrics,
    observedAt: snapshot.observedAt
  };
}

export function costGuardDisplay(result) {
  if (result.state === 'unverified') {
    return {
      title: '【要確認】AIコスト監視が確認できません',
      detail:
        'R2利用量または停止制御の実証が不足しています。AIの新規有料処理を開始しないでください。'
    };
  }
  if (result.state === 'stopped') {
    return {
      title: '【緊急】AIコストガード停止中',
      detail:
        'R2無料枠の90%到達、または運営者停止により新規対象処理は停止中です。再開には別途承認が必要です。'
    };
  }
  if (result.state === 'stop-required') {
    return {
      title: '【緊急】R2停止要求・停止未確認',
      detail:
        'R2無料枠の90%以上を検出しました。停止完了の証拠がないため、利用停止済みとみなせません。'
    };
  }
  if (result.state === 'urgent' || result.state === 'notice') {
    return {
      title:
        result.state === 'urgent'
          ? '【緊急予告】R2無料枠85%に接近'
          : '【注意】R2無料枠70%に接近',
      detail: `R2利用率 ${result.maxPercent}%（${result.limitingMetric}）。90%で新規対象処理の停止を要求します。`
    };
  }
  return {
    title: 'AIコストガード監視中',
    detail: `R2利用率 ${result.maxPercent}%（${result.limitingMetric}）。無料枠の上限まで継続監視します。`
  };
}
