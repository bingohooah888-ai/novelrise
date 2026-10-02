(() => {
  'use strict';

  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );

  let days = 30;
  let requestId = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function num(value) {
    return Number(value || 0).toLocaleString('ja-JP');
  }

  function setLoading(message = '共有経由の流入を集計しています...') {
    byId('shareAttributionVisits').textContent = '—';
    byId('shareAttributionRegistrations').textContent = '—';
    byId('shareAttributionStatus').textContent = message;
  }

  async function load() {
    const currentRequest = ++requestId;
    setLoading();

    const sessionResult = await client.auth.getSession();
    const session = sessionResult.data?.session;
    if (sessionResult.error || !session) {
      if (currentRequest === requestId) {
        byId('shareAttributionStatus').textContent =
          '共有経由の集計を確認するにはログインが必要です。';
      }
      return;
    }

    try {
      const response = await fetch(`/api/author-share-attribution?days=${days}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (currentRequest !== requestId) return;
      byId('shareAttributionVisits').textContent = num(data.visits);
      byId('shareAttributionRegistrations').textContent = num(
        data.registrations
      );
      byId('shareAttributionPeriod').textContent = `直近${days}日`;
      byId('shareAttributionStatus').textContent =
        'あなたの作品共有だけを集計しています。ランキングや露出優遇には使用しません。';
    } catch (error) {
      console.error('share attribution load failed', error);
      if (currentRequest !== requestId) return;
      byId('shareAttributionStatus').textContent =
        '共有経由の集計を取得できませんでした。時間をおいて再度お試しください。';
    }
  }

  function installStyles() {
    if (document.getElementById('share-attribution-lite-style')) return;
    const style = document.createElement('style');
    style.id = 'share-attribution-lite-style';
    style.textContent = `
      .share-attribution-lite{margin-top:26px;padding:27px;border:1px solid #ddd3bf;border-radius:18px;background:var(--novelight-paper,#fffdf7);box-shadow:0 14px 34px rgba(16,31,51,.055)}
      .share-attribution-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
      .share-attribution-kicker{color:#9a6b18;font-size:11px;font-weight:900;letter-spacing:.12em}
      .share-attribution-head h2{margin:4px 0 5px;font-size:22px}
      .share-attribution-head p{color:#6b7280;font-size:13px;line-height:1.7}
      .share-attribution-period{white-space:nowrap;color:#7a6541;font-size:12px;font-weight:800}
      .share-attribution-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .share-attribution-card{padding:18px;border:1px solid #e5ddcf;border-radius:14px;background:#fff}
      .share-attribution-label{color:#6b7280;font-size:12px;font-weight:800}
      .share-attribution-value{margin-top:7px;color:#172033;font-size:30px;font-weight:900;line-height:1.1}
      .share-attribution-sub{margin-top:7px;color:#8a8174;font-size:11px;line-height:1.6}
      .share-attribution-status{margin-top:14px;color:#6b7280;font-size:12px;line-height:1.7}
      @media(max-width:720px){.share-attribution-lite{padding:20px}.share-attribution-head{display:block}.share-attribution-period{display:block;margin-top:8px}.share-attribution-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function syncPeriodButton(button) {
    const next = Number(button?.dataset?.days);
    if (![7, 30, 90].includes(next) || next === days) return;
    days = next;
    void load();
  }

  installStyles();
  document.querySelectorAll('#period button').forEach((button) => {
    button.addEventListener('click', () => syncPeriodButton(button));
  });
  void load();
})();
