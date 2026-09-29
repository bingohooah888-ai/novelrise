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

  return Object.freeze({ MIN_SAMPLE, buildConversionSteps, generateHint });
});
