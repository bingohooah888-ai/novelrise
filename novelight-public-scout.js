(() => {
  if (!window.supabase) return;
  const userId = new URLSearchParams(window.location.search).get('id');
  const host = document.getElementById('publicScoutRecord');
  if (!userId || !host) return;

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const taxonomy = window.NovelightScoutTaxonomy;
  const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

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
      const rank = taxonomy?.rankForTier(tier) || { name: ['NOCTIS','VESPER','UMBRA','ASTRA','LUCENT','AURELIS','CELESTIA','EMPYREAN','SERAPH','LUMINARIS'][tier - 1] };
      const titles = Array.isArray(data.badges) ? data.badges : [];
      const equippedTitle = [...titles].sort((a, b) => {
        const aTime = a?.earned_at ? new Date(a.earned_at).getTime() : 0;
        const bTime = b?.earned_at ? new Date(b.earned_at).getTime() : 0;
        return bTime - aTime;
      })[0] || null;
      const equippedTitleName = equippedTitle
        ? equippedTitle.badge_id === 'limited_founding_author'
          ? equippedTitle.display_name
          : taxonomy?.titleName(equippedTitle.badge_id, equippedTitle.display_name) || equippedTitle.display_name
        : '未設定';
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
            <div class="public-scout-emblem">${esc(romans[tier] || String(tier))}</div>
            <strong>SCOUT RANK — ${esc(rank.name)}</strong>
          </div>
        </div>
        <div class="public-scout-summary">
          <div class="public-scout-kv"><span>Scout Level</span><strong>Lv.${level.toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>発掘成功</span><strong>${Number(data.discovery_success_count || 0).toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>装備称号</span><strong>${esc(equippedTitleName)}</strong></div>
        </div>
        ${discoveries.length ? `<div class="public-scout-label">代表的な発掘実績</div><div class="public-scout-discoveries">${discoveries.map((item) => `<span class="public-scout-discovery">${esc(item.title || '作品')} · ${item.nova_prediction ? 'NOVA' : '+' + Number(item.rank_delta || 0) + ' Rank'}</span>`).join('')}</div>` : ''}
      `;
      host.hidden = false;
    } catch (error) {
      console.error('Public SCOUT RECORD unavailable', error);
    }
  })();
})();
