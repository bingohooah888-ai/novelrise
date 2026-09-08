(() => {
  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );

  const metrics = {
    impressions: {
      label: 'インプレッション',
      totalKey: 'current_impressions',
      previousKey: 'previous_impressions'
    },
    detail_opens: {
      label: '作品ページ到達',
      totalKey: 'current_detail_opens',
      previousKey: 'previous_detail_opens'
    },
    first_episode_reads_10s: {
      label: '第1話10秒閲覧',
      totalKey: 'current_first_episode_reads_10s',
      previousKey: 'previous_first_episode_reads_10s'
    },
    continued_to_episode_2: {
      label: '第2話まで継続',
      totalKey: 'current_continued_to_episode_2',
      previousKey: 'previous_continued_to_episode_2'
    },
    favorites: {
      label: '露出後お気に入り',
      totalKey: 'current_favorites',
      previousKey: 'previous_favorites'
    }
  };

  let days = 30;
  let plan = 'free';
  let userId = null;
  let analyticsRequestId = 0;
  let selectedMetric = 'impressions';
  let trendRows = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function num(value) {
    return Number(value || 0).toLocaleString('ja-JP');
  }

  function rate(value, base) {
    return Number(base || 0) > 0
      ? `${((Number(value || 0) / Number(base)) * 100).toFixed(2)}%`
      : '0%';
  }

  function esc(value) {
    const holder = document.createElement('div');
    holder.textContent = value ?? '';
    return holder.innerHTML;
  }

  function normalizePlan(value) {
    const candidate = String(value || '').toLowerCase();
    if (candidate === 'premium') return 'premium';
    if (candidate === 'standard') return 'standard';
    return 'free';
  }

  function sumFunnel(rows) {
    return (rows || []).reduce(
      (total, row) => {
        total.impressions += Number(row.impressions || 0);
        total.detail_opens += Number(row.detail_opens || 0);
        total.first_episode_reads_10s += Number(
          row.first_episode_reads_10s || 0
        );
        total.continued_to_episode_2 += Number(
          row.continued_to_episode_2 || 0
        );
        total.favorites += Number(row.favorites || 0);
        return total;
      },
      {
        impressions: 0,
        detail_opens: 0,
        first_episode_reads_10s: 0,
        continued_to_episode_2: 0,
        favorites: 0
      }
    );
  }

  function totalsFromTrend(rows) {
    const first = rows?.[0];
    if (!first) return null;
    return {
      impressions: Number(first.current_impressions || 0),
      detail_opens: Number(first.current_detail_opens || 0),
      first_episode_reads_10s: Number(
        first.current_first_episode_reads_10s || 0
      ),
      continued_to_episode_2: Number(
        first.current_continued_to_episode_2 || 0
      ),
      favorites: Number(first.current_favorites || 0)
    };
  }

  function renderSummaryTotals(total) {
    const safe = total || {
      impressions: 0,
      detail_opens: 0,
      first_episode_reads_10s: 0,
      continued_to_episode_2: 0,
      favorites: 0
    };
    byId('impressions').textContent = num(safe.impressions);
    byId('detail').textContent = num(safe.detail_opens);
    byId('first').textContent = num(safe.first_episode_reads_10s);
    byId('second').textContent = num(safe.continued_to_episode_2);
    byId('favorites').textContent = num(safe.favorites);
    byId('ctr').textContent = `表示→作品ページ ${rate(
      safe.detail_opens,
      safe.impressions
    )}`;
    byId('firstRate').textContent = `作品ページ→第1話 ${rate(
      safe.first_episode_reads_10s,
      safe.detail_opens
    )}`;
    byId('secondRate').textContent = `第1話→第2話 ${rate(
      safe.continued_to_episode_2,
      safe.first_episode_reads_10s
    )}`;
    byId('favoriteRate').textContent = `表示→お気に入り ${rate(
      safe.favorites,
      safe.impressions
    )}`;
  }

  function clearSummary(message = '集計中...') {
    ['impressions', 'detail', 'first', 'second', 'favorites'].forEach((id) => {
      byId(id).textContent = '—';
    });
    ['ctr', 'firstRate', 'secondRate', 'favoriteRate'].forEach((id) => {
      byId(id).textContent = message;
    });
    document.querySelectorAll('.metric-change').forEach((element) => {
      element.textContent = `直前${days}日比 —`;
      element.className = 'metric-change neutral';
    });
    document.querySelectorAll('.spark-empty').forEach((element) => {
      element.textContent = 'データ蓄積中';
      element.hidden = false;
    });
    document.querySelectorAll('.sparkline path').forEach((path) => {
      path.setAttribute('d', '');
    });
  }

  function comparisonText(current, previous) {
    const nowValue = Number(current || 0);
    const priorValue = Number(previous || 0);
    if (priorValue === 0 && nowValue === 0) {
      return { text: `直前${days}日比 —`, className: 'neutral' };
    }
    if (priorValue === 0) {
      return { text: `直前${days}日比 新規`, className: 'up' };
    }
    const percentage = ((nowValue - priorValue) / priorValue) * 100;
    if (Math.abs(percentage) < 0.05) {
      return { text: `直前${days}日比 ±0.0%`, className: 'neutral' };
    }
    const arrow = percentage > 0 ? '↑' : '↓';
    return {
      text: `直前${days}日比 ${arrow} ${Math.abs(percentage).toFixed(1)}%`,
      className: percentage > 0 ? 'up' : 'down'
    };
  }

  function buildPath(values, width, height, padding = 5) {
    if (!values.length) return '';
    const maximum = Math.max(...values);
    const minimum = Math.min(...values);
    const spread = maximum - minimum;
    const usableWidth = Math.max(1, width - padding * 2);
    const usableHeight = Math.max(1, height - padding * 2);
    return values
      .map((value, index) => {
        const x =
          values.length === 1
            ? width / 2
            : padding + (usableWidth * index) / (values.length - 1);
        const ratio = spread === 0 ? 0.5 : (value - minimum) / spread;
        const y = padding + usableHeight * (1 - ratio);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }

  function hasEnoughTrend(values) {
    if (values.length < 2) return false;
    return values.filter((value) => Number(value || 0) > 0).length >= 2;
  }

  function renderComparisons(rows) {
    const first = rows?.[0];
    Object.entries(metrics).forEach(([key, config]) => {
      const element = byId(`change-${key}`);
      if (!element) return;
      if (!first) {
        element.textContent = `直前${days}日比 —`;
        element.className = 'metric-change neutral';
        return;
      }
      const comparison = comparisonText(
        first[config.totalKey],
        first[config.previousKey]
      );
      element.textContent = comparison.text;
      element.className = `metric-change ${comparison.className}`;
    });
  }

  function renderSparklines(rows) {
    Object.keys(metrics).forEach((key) => {
      const values = (rows || []).map((row) => Number(row[key] || 0));
      const path = byId(`spark-${key}`);
      const empty = byId(`spark-empty-${key}`);
      if (!path || !empty) return;
      if (!hasEnoughTrend(values)) {
        path.setAttribute('d', '');
        empty.hidden = false;
        return;
      }
      path.setAttribute('d', buildPath(values, 154, 48));
      empty.hidden = true;
    });
  }

  function formatBucket(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  }

  function renderTrendChart() {
    const config = metrics[selectedMetric];
    const values = trendRows.map((row) => Number(row[selectedMetric] || 0));
    const path = byId('trendLine');
    const dots = byId('trendDots');
    const empty = byId('trendEmpty');
    byId('trendTitle').textContent = `${config.label}・${days}日間の推移`;
    byId('trendDescription').textContent = `1日ごとの${config.label}を表示しています。`;
    byId('trendAxisStart').textContent = trendRows.length
      ? formatBucket(trendRows[0].bucket_date)
      : '—';
    byId('trendAxisEnd').textContent = trendRows.length
      ? formatBucket(trendRows[trendRows.length - 1].bucket_date)
      : '—';

    if (!hasEnoughTrend(values)) {
      path.setAttribute('d', '');
      dots.replaceChildren();
      empty.hidden = false;
      return;
    }

    const width = 920;
    const height = 250;
    const padding = 16;
    const maximum = Math.max(...values);
    const minimum = Math.min(...values);
    const spread = maximum - minimum;
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;
    path.setAttribute('d', buildPath(values, width, height, padding));
    dots.replaceChildren();
    values.forEach((value, index) => {
      const x =
        padding +
        (usableWidth * index) / Math.max(1, Math.max(1, values.length - 1));
      const ratio = spread === 0 ? 0.5 : (value - minimum) / spread;
      const y = padding + usableHeight * (1 - ratio);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', x.toFixed(2));
      dot.setAttribute('cy', y.toFixed(2));
      dot.setAttribute('r', '3.2');
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('aria-label', `${formatBucket(
        trendRows[index].bucket_date
      )} ${config.label} ${num(value)}`);
      dots.appendChild(dot);
    });
    empty.hidden = true;
  }

  function renderTrend(rows) {
    trendRows = rows || [];
    renderComparisons(trendRows);
    renderSparklines(trendRows);
    renderTrendChart();
  }

  function renderTrendUnavailable() {
    trendRows = [];
    renderComparisons([]);
    renderSparklines([]);
    renderTrendChart();
    byId('trendEmpty').textContent = '推移データを取得できませんでした。';
    byId('trendEmpty').hidden = false;
  }

  function renderPlanNote() {
    const note = byId('planNotice');
    if (plan === 'free') {
      note.innerHTML =
        '<div><strong>Freeでは全作品合計の基本LIGHT ANALYTICSを表示しています。</strong><p>期間推移と前期間比較は利用できます。作品ごとのファネルと追加露出の効果はStandard以上で確認できます。</p></div><a href="pricing.html">プランを確認する →</a>';
      return;
    }
    if (plan === 'premium') {
      note.innerHTML =
        '<div><strong>Premiumでは作品ごとのファネルと追加露出を確認できます。</strong><p>「プランによる追加露出」とPremium専用追加露出を分けて表示します。</p></div>';
      return;
    }
    note.innerHTML =
      '<div><strong>Standardでは作品ごとのファネルと追加露出を確認できます。</strong><p>読者がどの段階まで進んだかを作品単位で比較できます。</p></div>';
  }

  function renderFreeScope() {
    const section = byId('workAnalyticsSection');
    section.hidden = false;
    section.querySelector('h2').classList.add('hidden');
    byId('works').innerHTML =
      '<div class="notice"><strong>作品ごとの分析はStandard以上で確認できます。</strong><br>Freeでは全作品合計の基本ファネル・期間推移・前期間比較を利用できます。</div>';
  }

  function funnelStep(label, value, base, previousValue = null) {
    const count = Number(value || 0);
    const firstBase = Number(base || 0);
    const width = firstBase > 0 ? Math.max(4, (count / firstBase) * 100) : 0;
    const conversion = previousValue === null ? '起点' : rate(count, previousValue);
    return `<div class="funnel-node"><div class="funnel-node-head"><span>${esc(
      label
    )}</span><strong>${num(count)}</strong></div><div class="funnel-track"><span class="funnel-fill" style="width:${Math.min(
      100,
      width
    ).toFixed(2)}%"></span></div><small>${esc(conversion)}</small></div>`;
  }

  function renderWorks(rows) {
    const section = byId('workAnalyticsSection');
    const heading = section.querySelector('h2');
    const element = byId('works');
    section.hidden = false;
    heading.classList.remove('hidden');
    if (!rows.length) {
      element.innerHTML = '<div class="notice">この期間にはまだ露出データがありません。</div>';
      return;
    }
    element.innerHTML = rows
      .map((row) => {
        const impressions = Number(row.impressions || 0);
        const paid = Number(row.plan_extra_impressions || 0);
        const premium = Number(row.premium_slot_impressions || 0);
        return `<article class="work"><div class="work-heading"><div><span class="work-eyebrow">作品別ファネル</span><h3 class="work-title">${esc(
          row.title || 'タイトル未設定'
        )}</h3></div><span class="work-window">直近${days}日</span></div><div class="funnel-visual">${funnelStep(
          '表示',
          row.impressions,
          impressions
        )}${funnelStep(
          '作品ページ',
          row.detail_opens,
          impressions,
          row.impressions
        )}${funnelStep(
          '第1話10秒',
          row.first_episode_reads_10s,
          impressions,
          row.detail_opens
        )}${funnelStep(
          '第2話継続',
          row.continued_to_episode_2,
          impressions,
          row.first_episode_reads_10s
        )}${funnelStep(
          'お気に入り',
          row.favorites,
          impressions,
          row.continued_to_episode_2
        )}</div><div class="paid">プランによる追加露出：表示 ${num(
          paid
        )} / 作品ページ ${num(row.plan_extra_detail_opens)} / 本文10秒 ${num(
          row.plan_extra_body_reads_10s
        )} / 表示→本文 ${rate(
          row.plan_extra_body_reads_10s,
          paid
        )}</div>${
          plan === 'premium'
            ? `<div class="paid premium">Premium専用追加露出：表示 ${num(
                premium
              )} / 作品ページ ${num(
                row.premium_slot_detail_opens
              )} / 本文10秒 ${num(
                row.premium_slot_body_reads_10s
              )} / 表示→本文 ${rate(
                row.premium_slot_body_reads_10s,
                premium
              )}</div>`
            : ''
        }</article>`;
      })
      .join('');
  }

  function renderFunnelFailure() {
    const section = byId('workAnalyticsSection');
    section.hidden = false;
    section.querySelector('h2').classList.remove('hidden');
    byId('works').innerHTML =
      '<div class="notice error">作品別ファネルを取得できませんでした。</div>';
  }

  async function loadAnalytics() {
    const requestId = ++analyticsRequestId;
    const status = byId('status');
    clearSummary();
    byId('works').innerHTML = '';
    status.innerHTML = '<div class="notice">LIGHT ANALYTICSを読み込んでいます...</div>';

    const [funnelResult, trendResult] = await Promise.all([
      client.rpc('novelight_author_exposure_funnel_v2', { p_days: days }),
      client.rpc('novelight_author_analytics_timeseries', { p_days: days })
    ]);
    if (requestId !== analyticsRequestId) return;

    const funnelOk = !funnelResult.error;
    const trendOk = !trendResult.error;
    if (trendOk) {
      renderTrend(trendResult.data || []);
    } else {
      console.error(trendResult.error);
      renderTrendUnavailable();
    }

    if (funnelOk) {
      const rows = funnelResult.data || [];
      renderSummaryTotals(sumFunnel(rows));
      if (plan === 'free') renderFreeScope();
      else renderWorks(rows);
    } else {
      console.error(funnelResult.error);
      const fallback = trendOk ? totalsFromTrend(trendResult.data || []) : null;
      if (fallback) renderSummaryTotals(fallback);
      if (plan === 'free') renderFreeScope();
      else renderFunnelFailure();
    }

    renderPlanNote();
    if (funnelOk && trendOk) {
      status.innerHTML = '';
    } else if (funnelOk || trendOk) {
      status.innerHTML =
        '<div class="notice error">一部の分析データを取得できませんでした。表示できる情報のみ更新しています。</div>';
    } else {
      clearSummary('取得できませんでした');
      status.innerHTML =
        '<div class="notice error">LIGHT ANALYTICSを読み込めませんでした。時間をおいて再度お試しください。</div>';
    }
  }

  async function loadBasic() {
    const status = byId('basicStatus');
    status.innerHTML = '<div class="notice">読み込み中...</div>';
    try {
      const result = await client.rpc('novelight_author_basic_metrics');
      if (result.error) throw result.error;
      const metricsRow = Array.isArray(result.data) ? result.data[0] : result.data;
      byId('novelCount').textContent = num(metricsRow?.novel_count);
      byId('pv').textContent = num(metricsRow?.total_pv);
      byId('favoriteTotal').textContent = num(metricsRow?.total_favorites);
      status.innerHTML = '';
    } catch (error) {
      console.error(error);
      ['novelCount', 'pv', 'favoriteTotal'].forEach((id) => {
        byId(id).textContent = '—';
      });
      status.innerHTML =
        '<div class="notice error">基本分析を読み込めませんでした。時間をおいて再度お試しください。</div>';
    }
  }

  document.querySelectorAll('#period button').forEach((button) => {
    button.addEventListener('click', async () => {
      const next = Number(button.dataset.days);
      if (next === days) return;
      days = next;
      document.querySelectorAll('#period button').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === button);
      });
      await loadAnalytics();
    });
  });

  document.querySelectorAll('[data-trend-metric]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedMetric = button.dataset.trendMetric;
      document.querySelectorAll('[data-trend-metric]').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === button);
      });
      renderTrendChart();
    });
  });

  (async () => {
    await NovelightClient.recordVisit(client);
    const auth = await client.auth.getSession();
    if (!auth.data.session) {
      location.href = 'login.html?redirect=analytics.html';
      return;
    }
    userId = auth.data.session.user.id;
    void NovelightClient.claimAcquisition(client);
    const profile = await client
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single();
    if (profile.error) {
      console.error(profile.error);
      plan = 'free';
    } else {
      plan = normalizePlan(profile.data?.plan);
    }
    renderPlanNote();
    await Promise.all([loadAnalytics(), loadBasic()]);
  })();
})();