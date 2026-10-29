/* The bookshelf uses the same read-only Scout RPCs and artwork as SCOUT RECORD. */
(() => {
  'use strict';
  const rankNames = [
    '', 'NOCTIS', 'VESPER', 'UMBRA', 'ASTRA', 'LUCENT',
    'AURELIS', 'CELESTIA', 'EMPYREAN', 'SERAPH', 'LUMINARIS'
  ];
  const rankImages = [
    '', 'scout_rank_01_noctis.png', 'scout_rank_02_vesper.png',
    'scout_rank_03_umbra.png', 'scout_rank_04_astra.png',
    'scout_rank_05_lucent.png', 'scout_rank_06_aurelis.png',
    'scout_rank_07_celestia.png', 'scout_rank_08_empyrean.png',
    'scout_rank_09_seraph.png', 'scout_rank_10_luminaris.png'
  ];
  const format = (value) => Math.max(0, Number(value) || 0).toLocaleString('ja-JP');
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  function showRank(summary) {
    const tier = Math.max(1, Math.min(10, Number(summary.rank_tier) || 1));
    const level = Math.max(1, Number(summary.level) || 1);
    const maxed = summary.beta_level_max === true;
    const into = Math.max(0, Number(summary.xp_into_level) || 0);
    const needed = Math.max(0, Number(summary.xp_for_next_level) || 0);
    const percentage = maxed ? 100 : needed ? Math.min(100, (into / needed) * 100) : 0;
    const image = document.getElementById('nlShelfRankImage');
    if (image) image.src = 'assets/scout-record/ranks/' + rankImages[tier];
    setText('nlShelfRankName', rankNames[tier]);
    setText('nlShelfRankLevel', 'Lv.' + format(level));
    setText('nlShelfRankXp', format(summary.total_xp));
    setText('nlShelfRankNext', maxed ? 'β上限到達' : '次Lv. ' + format(summary.next_level_xp) + ' XP');
    setText('nlShelfRankProgress', maxed ? 'β LEVEL MAX' : format(into) + ' / ' + format(needed) + ' XP');
    const bar = document.getElementById('nlShelfRankProgressBar');
    const track = document.getElementById('nlShelfRankProgressTrack');
    if (bar) bar.style.width = percentage.toFixed(1) + '%';
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percentage)));
  }

  function showSeeds(data) {
    const tiers = [
      ['Gold', 'gold', 6],
      ['Silver', 'silver', 3],
      ['Bronze', 'bronze', 2]
    ];
    let allocatedSum = 0;
    let remainingSum = 0;
    tiers.forEach(([label, key, fallback]) => {
      const allocated = Math.max(0, Number(data[key + '_allocated'] ?? fallback) || 0);
      const remaining = Math.max(0, Number(data[key + '_remaining']) || 0);
      allocatedSum += allocated;
      remainingSum += remaining;
      setText('nlShelfSeed' + label, format(remaining) + ' / ' + format(allocated));
    });
    const total = Math.max(0, Number(data.remaining_this_month ?? remainingSum) || 0);
    const limit = Math.max(0, Number(data.monthly_limit ?? allocatedSum) || 0);
    setText('nlShelfSeedTotal', format(total) + ' / ' + format(limit));
  }

  async function load(client) {
    const [summary, inventory] = await Promise.allSettled([
      client.rpc('novelight_scout_record_summary'),
      client.rpc('novelight_light_seed_inventory')
    ]);
    if (summary.status === 'fulfilled' && !summary.value.error) {
      showRank(summary.value.data || {});
    } else {
      setText('nlShelfRankName', '取得できません');
      console.warn('bookshelf Scout Rank unavailable', summary.status === 'rejected' ? summary.reason : summary.value.error);
    }
    if (inventory.status === 'fulfilled' && !inventory.value.error) {
      showSeeds(inventory.value.data || {});
    } else {
      setText('nlShelfSeedTotal', '取得できません');
      console.warn('bookshelf LIGHT SEED inventory unavailable', inventory.status === 'rejected' ? inventory.reason : inventory.value.error);
    }
  }

  window.NovelightBookshelfOverview = { load };
})();
