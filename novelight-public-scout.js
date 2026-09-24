(() => {
  if (!window.supabase) return;
  const userId = new URLSearchParams(window.location.search).get('id');
  const host = document.getElementById('publicScoutRecord');
  if (!userId || !host) return;

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const rankNames = [
    '',
    'NOCTIS',
    'VESPER',
    'UMBRA',
    'ASTRA',
    'LUCENT',
    'AURELIS',
    'CELESTIA',
    'EMPYREAN',
    'SERAPH',
    'LUMINARIS'
  ];

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  (async () => {
    try {
      const { data, error } = await client.rpc('novelight_public_scout_record', {
        p_user_id: userId
      });
      if (error) throw error;
      if (!data) return;

      const level = Number(data.level || 1);
      const tier = Math.max(1, Math.min(10, Number(data.rank_tier || 1)));
      const titles = Array.isArray(data.badges) ? data.badges : [];
      const equippedTitle = titles[0] || null;
      const discoveries = Array.isArray(data.representative_discoveries)
        ? data.representative_discoveries
        : [];

      host.innerHTML = `
        <div class="public-scout-head">
          <div>
            <h2>SCOUT RECORD</h2>
            <p>公開されている発掘実績</p>
          </div>
          <div class="public-scout-rank">
            <div class="public-scout-emblem">${esc(rankNames[tier].slice(0, 1))}</div>
            <strong>${esc(rankNames[tier])}</strong>
          </div>
        </div>
        <div class="public-scout-summary">
          <div class="public-scout-kv"><span>Scout Level</span><strong>Lv.${level.toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>発掘成功</span><strong>${Number(data.discovery_success_count || 0).toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>装備称号</span><strong>${equippedTitle ? esc(equippedTitle.display_name) : "—"}</strong></div>
        </div>
        ${equippedTitle ? `<div class="public-scout-label">装備称号</div><div class="public-scout-badges"><span class="public-scout-badge">${esc(equippedTitle.display_name)}</span></div>` : ""}
        ${discoveries.length ? `<div class="public-scout-label">代表的な発掘実績</div><div class="public-scout-discoveries">${discoveries.map((item) => `<span class="public-scout-discovery">${esc(item.title || '作品')} · ${item.nova_prediction ? 'NOVA' : '+' + Number(item.rank_delta || 0) + ' Rank'}</span>`).join('')}</div>` : ''}
      `;
      host.hidden = false;
    } catch (error) {
      console.error('Public SCOUT RECORD unavailable', error);
    }
  })();
})();
