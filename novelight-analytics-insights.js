(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NovelightAnalyticsInsights = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MIN_SAMPLE = 50;

  function count(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  function buildConversionSteps(total) {
    const safe = total || {};
    const steps = [
      {
        label: '表示→作品ページ',
        numerator: count(safe.detail_opens),
        denominator: count(safe.impressions)
      },
      {
        label: '作品ページ→第1話10秒',
        numerator: count(safe.first_episode_reads_10s),
        denominator: count(safe.detail_opens)
      },
      {
        label: '第1話10秒→第2話継続',
        numerator: count(safe.continued_to_episode_2),
        denominator: count(safe.first_episode_reads_10s)
      }
    ];
    return steps.map((step) => ({
      ...step,
      rate: step.denominator > 0
        ? (step.numerator / step.denominator) * 100
        : null
    }));
  }

  function generateHint(total, minSample = MIN_SAMPLE) {
    const threshold = Math.max(1, Number(minSample) || MIN_SAMPLE);
    const steps = buildConversionSteps(total);
    if (
      steps.some(
        (step) => step.denominator < threshold || step.rate === null
      )
    ) {
      return {
        kind: 'collecting',
        text: `データ蓄積中（各区間${threshold}件以上で数値ヒントを表示します）`
      };
    }
    const lowest = steps.reduce((current, step) =>
      step.rate < current.rate ? step : current
    );
    return {
      kind: 'numeric',
      text: `この期間で転換率が最も低い区間は「${lowest.label}」の${lowest.rate.toFixed(1)}%です。`
    };
  }

  // Both counts refer to the same reader/work cohort.
  function readCohortCount(value) {
    if (
      typeof value !== 'number' &&
      !(typeof value === 'string' && /^\d+$/u.test(value))
    ) return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
  }

  function retentionWindow(first, second) {
    const started = readCohortCount(first);
    const continued = readCohortCount(second);
    if (started === null || continued === null || continued > started)
      return null;
    return {
      started,
      continued,
      notYet: started - continued,
      rate: started >= MIN_SAMPLE ? (continued / started) * 100 : null
    };
  }

  function buildRetentionComparison(row) {
    if (!row || typeof row !== 'object') return null;
    const current = retentionWindow(
      row.current_first_episode_reads_10s,
      row.current_continued_to_episode_2
    );
    if (!current) return null;
    const previous = retentionWindow(
      row.previous_first_episode_reads_10s,
      row.previous_continued_to_episode_2
    );
    const difference =
      current.rate !== null && previous?.rate != null
        ? current.rate - previous.rate
        : null;
    return { current, previous, difference };
  }

  function retentionText(cohort) {
    if (!cohort) return '集計値を取得できませんでした。';
    if (cohort.rate === null) {
      return 'データ蓄積中（第1話の読書記録' + MIN_SAMPLE + '件以上で数値ヒントを表示）';
    }
    return (
      formatCount(cohort.continued) + ' / ' + formatCount(cohort.started) +
      '件（' + cohort.rate.toFixed(1) + '%）／第2話の継続記録なし：' +
      formatCount(cohort.notYet) + '件（離脱確定ではありません）'
    );
  }

  function workRetentionText(row) {
    return retentionText(retentionWindow(
      row?.first_episode_reads_10s,
      row?.continued_to_episode_2
    ));
  }

  function retentionComparisonText(row, days) {
    const comparison = buildRetentionComparison(row);
    if (!comparison || ![7, 30, 90].includes(days)) {
      return '継続比較データを取得できませんでした。';
    }
    const difference = comparison.difference;
    return (
      '直近' + days + '日：' + retentionText(comparison.current) +
      '\n直前' + days + '日：' + retentionText(comparison.previous) +
      (difference === null
        ? '\n十分な比較データがありません。'
        : '\n継続率の差：' + (difference > 0 ? '+' : '') +
          difference.toFixed(1) + 'ポイント（観測値）')
    );
  }

  function renderRetentionComparison(row, days) {
    const sections = ensureSections();
    if (!sections) return;
    let detail = document.getElementById('analyticsRetentionComparison');
    if (!detail) {
      detail = document.createElement('div');
      detail.id = 'analyticsRetentionComparison';
      detail.className = 'notice';
      const heading = document.createElement('h3');
      heading.textContent = '第1話→第2話の継続比較（非AI）';
      detail.appendChild(heading);
      const result = document.createElement('p');
      result.id = 'analyticsRetentionResult';
      result.style.whiteSpace = 'pre-line';
      result.setAttribute('aria-live', 'polite');
      detail.appendChild(result);
      const note = document.createElement('p');
      note.textContent =
        '作品ごとの読書記録を集計した観測値です。直前期間の読者は継続する時間が長いため、差は作品の改善・悪化を証明しません。原因や第3話以降の離脱は判定できません。';
      detail.appendChild(note);
      sections.hintSection.appendChild(detail);
    }
    document.getElementById('analyticsRetentionResult').textContent = row
      ? retentionComparisonText(row, days)
      : '比較データを読み込み中、または取得できませんでした。';
  }

  function readDisplayedCount(id) {
    const element = document.getElementById(id);
    if (!element) return null;
    const text = String(element.textContent || '').trim();
    if (!/^\d[\d,]*$/u.test(text)) return null;
    const numeric = Number(text.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function readDisplayedTotals() {
    const values = {
      impressions: readDisplayedCount('impressions'),
      detail_opens: readDisplayedCount('detail'),
      first_episode_reads_10s: readDisplayedCount('first'),
      continued_to_episode_2: readDisplayedCount('second')
    };
    return Object.values(values).some((value) => value === null) ? null : values;
  }

  function ensureSections() {
    const basic = document.querySelector(
      'section[aria-labelledby="basicAnalyticsHeading"]'
    );
    if (!basic) return null;

    let funnelSection = document.getElementById('conversionFunnelSection');
    if (!funnelSection) {
      funnelSection = document.createElement('section');
      funnelSection.id = 'conversionFunnelSection';
      funnelSection.className = 'trend-panel';
      funnelSection.setAttribute('aria-labelledby', 'conversionFunnelHeading');
      funnelSection.innerHTML =
        '<h2 id="conversionFunnelHeading" class="section-title" style="margin-top:0">コンバージョンファネル</h2>' +
        '<div id="conversionFunnel" class="basic"></div>';
      basic.after(funnelSection);
    }

    let hintSection = document.getElementById('analyticsHintsSection');
    if (!hintSection) {
      hintSection = document.createElement('section');
      hintSection.id = 'analyticsHintsSection';
      hintSection.className = 'trend-panel';
      hintSection.setAttribute('aria-labelledby', 'analyticsHintsHeading');
      hintSection.innerHTML =
        '<h2 id="analyticsHintsHeading" class="section-title" style="margin-top:0">数値ヒント</h2>' +
        '<div id="analyticsHints" class="notice">データ蓄積中</div>';
      funnelSection.after(hintSection);
    }
    return { funnelSection, hintSection };
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString('ja-JP');
  }

  function render() {
    if (!ensureSections()) return;
    const funnel = document.getElementById('conversionFunnel');
    const hint = document.getElementById('analyticsHints');
    const total = readDisplayedTotals();
    if (!total) {
      funnel.innerHTML = '<div class="notice">データ蓄積中</div>';
      hint.textContent = 'データ蓄積中';
      return;
    }

    funnel.innerHTML = buildConversionSteps(total)
      .map(
        (step) =>
          `<article class="metric"><div class="value">${
            step.rate === null ? '—' : `${step.rate.toFixed(1)}%`
          }</div><div class="label">${step.label}</div><div class="sub">${formatCount(
            step.numerator
          )} / ${formatCount(step.denominator)}</div></article>`
      )
      .join('');
    hint.textContent = generateHint(total).text;
  }

  if (typeof document !== 'undefined') {
    ensureSections();
    const summary = document.getElementById('summary');
    if (summary && typeof MutationObserver !== 'undefined') {
      new MutationObserver(render).observe(summary, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    render();
  }

  return Object.freeze({
    MIN_SAMPLE,
    buildConversionSteps,
    generateHint,
    buildRetentionComparison,
    workRetentionText,
    retentionComparisonText,
    renderRetentionComparison
  });
});
