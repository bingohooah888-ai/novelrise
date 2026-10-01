const RANGE_VALUES = new Set(['7', '30', '90', 'all']);

export function normalizeAdminRange(value) {
  const normalized = String(value ?? '30').trim().toLowerCase();
  return RANGE_VALUES.has(normalized) ? normalized : '30';
}

export function percentDelta(current, baseline) {
  const now = Number(current ?? 0);
  const base = Number(baseline ?? 0);
  if (!Number.isFinite(now) || !Number.isFinite(base) || base === 0) {
    return null;
  }
  return Math.round(((now - base) / base) * 1000) / 10;
}

export function average(rows, key) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + Number(row?.[key] ?? 0), 0);
  return total / rows.length;
}

export function buildMetricComparisons(rows, keys) {
  const sorted = [...(rows ?? [])].sort((a, b) =>
    String(a.metric_date).localeCompare(String(b.metric_date))
  );
  const today = sorted.at(-1) ?? {};
  const yesterday = sorted.at(-2) ?? {};
  const previousSeven = sorted.slice(Math.max(0, sorted.length - 8), -1);

  return Object.fromEntries(
    keys.map((key) => {
      const sevenDayAverage = average(previousSeven, key);
      return [
        key,
        {
          previousDayPct: percentDelta(today[key], yesterday[key]),
          sevenDayAveragePct: percentDelta(today[key], sevenDayAverage),
          sevenDayAverage: Math.round(sevenDayAverage * 10) / 10
        }
      ];
    })
  );
}

export function buildAdminAlerts({
  rows,
  pendingInquiries = 0,
  unresolvedRenderFailures = 0,
  zeroPvRate = null,
  publishedWorks = 0
}) {
  const sorted = [...(rows ?? [])].sort((a, b) =>
    String(a.metric_date).localeCompare(String(b.metric_date))
  );
  const yesterday = sorted.at(-2) ?? null;
  const prior = sorted.slice(Math.max(0, sorted.length - 9), -2);
  const alerts = [];

  if (yesterday && prior.length >= 3) {
    const visitorAverage = average(prior, 'unique_visitors');
    if (
      visitorAverage >= 5 &&
      Number(yesterday.unique_visitors ?? 0) < visitorAverage * 0.6
    ) {
      alerts.push({
        code: 'VISITORS_DOWN',
        severity: 'warning',
        title: '来訪者が直近平均から大きく低下',
        detail: `直近完了日は過去平均比 ${percentDelta(
          yesterday.unique_visitors,
          visitorAverage
        )}% です。`
      });
    }

    const registrationRate =
      Number(yesterday.unique_visitors ?? 0) > 0
        ? Number(yesterday.new_users ?? 0) / Number(yesterday.unique_visitors)
        : null;
    const priorRegistrationRates = prior
      .filter((row) => Number(row.unique_visitors ?? 0) > 0)
      .map((row) => Number(row.new_users ?? 0) / Number(row.unique_visitors));
    const averageRate = priorRegistrationRates.length
      ? priorRegistrationRates.reduce((sum, value) => sum + value, 0) /
        priorRegistrationRates.length
      : null;
    if (
      registrationRate !== null &&
      averageRate !== null &&
      averageRate >= 0.01 &&
      registrationRate < averageRate * 0.5
    ) {
      alerts.push({
        code: 'REGISTRATION_RATE_DOWN',
        severity: 'warning',
        title: '登録率が直近平均から低下',
        detail: '来訪者に対する新規登録率を確認してください。'
      });
    }
  }

  if (Number(pendingInquiries) >= 10) {
    alerts.push({
      code: 'INQUIRIES_BACKLOG',
      severity: 'warning',
      title: '未対応お問い合わせが増加',
      detail: `未対応・対応中が ${Number(pendingInquiries)} 件あります。`
    });
  }

  if (Number(unresolvedRenderFailures) >= 5) {
    alerts.push({
      code: 'RENDER_FAILURES',
      severity: 'critical',
      title: 'サムネイル生成エラーが増加',
      detail: `24時間以内の未解決エラーが ${Number(unresolvedRenderFailures)} 件あります。`
    });
  }

  if (
    Number(publishedWorks) >= 10 &&
    Number.isFinite(Number(zeroPvRate)) &&
    Number(zeroPvRate) >= 40
  ) {
    alerts.push({
      code: 'ZERO_PV_RATE_HIGH',
      severity: 'warning',
      title: 'PVゼロ作品率が高い',
      detail: `公開作品の ${Number(zeroPvRate).toFixed(1)}% がPVゼロです。`
    });
  }

  return alerts;
}
