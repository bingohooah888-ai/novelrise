(() => {
  'use strict';

  const ids = {
    impressions: 'impressions',
    detail: 'detail',
    first: 'first'
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function parseMetric(id) {
    const text = byId(id)?.textContent?.trim() || '';
    if (!text || text === '—') return null;
    const value = Number(text.replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function currentDays() {
    const active = document.querySelector('#period button.active[data-days]');
    const value = Number(active?.dataset.days || 30);
    return Number.isFinite(value) && value > 0 ? value : 30;
  }

  function format(value) {
    return Number(value || 0).toLocaleString('ja-JP');
  }

  function percent(value, base) {
    return Number(base || 0) > 0
      ? `${((Number(value || 0) / Number(base)) * 100).toFixed(1)}%`
      : '0.0%';
  }

  function render() {
    const root = byId('opportunitySummary');
    if (!root) return;

    const impressions = parseMetric(ids.impressions);
    const detail = parseMetric(ids.detail);
    const first = parseMetric(ids.first);
    const days = currentDays();

    byId('opportunityPeriod').textContent = `直近${days}日`;

    if (impressions === null || detail === null || first === null) {
      byId('opportunityImpressions').textContent = '—';
      byId('opportunityDetail').textContent = '—';
      byId('opportunityReading').textContent = '—';
      byId('opportunityDetailRate').textContent = '集計中...';
      byId('opportunityReadingRate').textContent = '集計中...';
      byId('opportunityMessage').textContent =
        'この期間にNOVELIGHT上で作品がどれだけ読者の前へ届いたかを集計しています。';
      return;
    }

    byId('opportunityImpressions').textContent = format(impressions);
    byId('opportunityDetail').textContent = format(detail);
    byId('opportunityReading').textContent = format(first);
    byId('opportunityDetailRate').textContent = `表示→作品ページ ${percent(
      detail,
      impressions
    )}`;
    byId('opportunityReadingRate').textContent = `作品ページ→第1話 ${percent(
      first,
      detail
    )}`;

    if (impressions === 0) {
      byId('opportunityMessage').textContent =
        'まだ露出データはありません。作品公開後、NOVELIGHT上で得られた発見機会をここで確認できます。';
      return;
    }

    if (detail === 0) {
      byId('opportunityMessage').textContent =
        `作品はこの期間に${format(impressions)}回、NOVELIGHT上で読者の前に表示されました。次は作品ページ到達の変化を確認できます。`;
      return;
    }

    if (first === 0) {
      byId('opportunityMessage').textContent =
        `作品は${format(impressions)}回表示され、そのうち${format(detail)}回が作品ページ到達につながりました。第1話10秒閲覧はこれから蓄積されます。`;
      return;
    }

    byId('opportunityMessage').textContent =
      `作品は${format(impressions)}回表示され、そのうち${format(detail)}回が作品ページ到達、${format(first)}回が第1話10秒閲覧につながりました。`;
  }

  function install() {
    const summary = byId('summary');
    const period = byId('period');
    if (!summary || !period || !byId('opportunitySummary')) return;

    const observer = new MutationObserver(render);
    observer.observe(summary, {
      subtree: true,
      childList: true,
      characterData: true
    });
    observer.observe(period, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
