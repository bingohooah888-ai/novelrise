(() => {
  'use strict';

  if (!window.supabase || document.getElementById('scoutShareDiscoveryPanel')) return;

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const numberFormat = new Intl.NumberFormat('ja-JP');

  function buildPanel() {
    const panel = document.createElement('section');
    panel.id = 'scoutShareDiscoveryPanel';
    panel.className = 'scout-panel';
    panel.setAttribute('aria-labelledby', 'scoutShareDiscoveryTitle');
    panel.innerHTML =
      '<div class="scout-section-head">' +
      '<div><h2 id="scoutShareDiscoveryTitle">共有から見つかった読者</h2>' +
      '<p>あなたが共有した作品をきっかけに、実際に有効読書まで到達した読者の記録です。クリック数ではありません。</p></div>' +
      '<strong id="scoutShareDiscoveryCount">—</strong></div>' +
      '<p class="scout-note">この記録はあなたと運営だけが確認できます。Scout XP・Scout Point・Scout Rank・作品Rankには影響しません。</p>' +
      '<div id="scoutShareDiscoveryList" class="scout-list"><div class="scout-loading">共有実績を読み込んでいます。</div></div>';

    const seedHistory = document.querySelector('[aria-labelledby="seedHistoryTitle"]');
    if (seedHistory) seedHistory.before(panel);
    else document.querySelector('main')?.appendChild(panel);
    return panel;
  }

  function rowForWork(work) {
    const row = document.createElement('div');
    row.className = 'scout-list-item';

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = work?.title || `作品 ${work?.novelId ?? ''}`;
    const meta = document.createElement('small');
    const latest = work?.latestDiscoveryAt
      ? new Date(work.latestDiscoveryAt).toLocaleString('ja-JP')
      : '—';
    meta.textContent = `最終発見 ${latest}`;
    copy.append(title, meta);

    const count = document.createElement('strong');
    count.textContent = `${numberFormat.format(Number(work?.discoveredReaders || 0))}人`;
    row.append(copy, count);
    return row;
  }

  async function load() {
    buildPanel();
    const count = document.getElementById('scoutShareDiscoveryCount');
    const list = document.getElementById('scoutShareDiscoveryList');

    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session) {
        count.textContent = '—';
        list.innerHTML = '<div class="scout-loading">ログインすると共有実績を確認できます。</div>';
        return;
      }

      const { data, error } = await client.rpc('novelight_scout_share_attribution', {
        p_limit: 20
      });
      if (error) {
        if (error.code === '42883' || error.code === 'PGRST202') {
          count.textContent = '—';
          list.innerHTML = '<div class="scout-loading">共有実績のDB反映待ちです。</div>';
          return;
        }
        throw error;
      }

      count.textContent = `${numberFormat.format(Number(data?.discoveredReaders || 0))}人`;
      list.replaceChildren();
      const works = Array.isArray(data?.works) ? data.works : [];
      if (!works.length) {
        list.innerHTML = '<div class="scout-loading">共有から有効読書へ到達した読者はまだいません。</div>';
        return;
      }
      works.forEach((work) => list.appendChild(rowForWork(work)));
    } catch (error) {
      console.error('SCOUT share attribution load failed', error);
      count.textContent = '—';
      list.innerHTML = '<div class="scout-loading">共有実績を取得できませんでした。</div>';
    }
  }

  void load();
})();
