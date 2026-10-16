(() => {
  if (!window.supabase) return;
  const userId = new URLSearchParams(window.location.search).get('id');
  const host = document.getElementById('publicScoutRecord');
  const profileHost = document.getElementById('profile');
  if (!userId || (!host && !profileHost)) return;

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
  // The same official rank artwork paths as the main SCOUT RECORD screen.
  const rankArtworkPaths = [
    '',
    'assets/scout-record/ranks/scout_rank_01_noctis.png',
    'assets/scout-record/ranks/scout_rank_02_vesper.png',
    'assets/scout-record/ranks/scout_rank_03_umbra.png',
    'assets/scout-record/ranks/scout_rank_04_astra.png',
    'assets/scout-record/ranks/scout_rank_05_lucent.png',
    'assets/scout-record/ranks/scout_rank_06_aurelis.png',
    'assets/scout-record/ranks/scout_rank_07_celestia.png',
    'assets/scout-record/ranks/scout_rank_08_empyrean.png',
    'assets/scout-record/ranks/scout_rank_09_seraph.png',
    'assets/scout-record/ranks/scout_rank_10_luminaris.png'
  ];
  const EQUIPPED_BADGE_WIDTH = 256;
  const EQUIPPED_BADGE_QUALITY = 80;

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  // Keep the public equipped icon aligned with the official SCOUT collection artwork.
  const badgeArtworkOverrides = {
    reader_read_500: 'assets/scout-badges/hard_reader_read_500.png',
    reader_silver_seed_010: 'assets/scout-badges/reader_seed_500.png',
    reader_gold_seed_005: 'assets/scout-badges/reader_seed_250.png',
    reader_discovery_plus2_005: 'assets/scout-badges/reader_bronze_seed_003.png',
    reader_discovery_plus2_010: 'assets/scout-badges/reader_bronze_seed_005.png',
    reader_discovery_plus2_050: 'assets/scout-badges/hard_reader_discovery_plus2_050.png',
    reader_discovery_plus2_100: 'assets/scout-badges/hard_reader_discovery_plus2_100.png',
    reader_new_author_025: 'assets/scout-badges/reader_discovery_plus2_050.png',
    reader_new_author_050: 'assets/scout-badges/reader_discovery_plus2_100.png',
    reader_new_author_100: 'assets/scout-badges/reader_new_author_025.png',
    reader_genre_010: 'assets/scout-badges/reader_low_rank_010.png',
    reader_new_work_025: 'assets/scout-badges/reader_genre_020.png',
    reader_low_rank_025: 'assets/scout-badges/reader_new_author_050.png',
    reader_read_200: 'assets/scout-badges/reader_read_250.png',
    reader_read_300: 'assets/scout-badges/reader_read_500.png',
    reader_bronze_seed_015: 'assets/scout-badges/reader_seed_1000.png',
    reader_discovery_plus2_020: 'assets/scout-badges/reader_bronze_seed_010.png',
    reader_discovery_plus3_001: 'assets/scout-badges/reader_silver_seed_003.png',
    reader_discovery_plus3_005: 'assets/scout-badges/reader_silver_seed_005.png',
    reader_discovery_plus3_010: 'assets/scout-badges/reader_silver_seed_010.png',
    reader_discovery_plus4_001: 'assets/scout-badges/reader_gold_seed_003.png',
    reader_discovery_plus4_002: 'assets/scout-badges/reader_gold_seed_005.png',
    reader_discovery_plus4_005: 'assets/scout-badges/reader_gold_seed_010.png',
    reader_nova_001: 'assets/scout-badges/reader_discovery_plus2_005.png',
    reader_nova_003: 'assets/scout-badges/reader_discovery_plus2_010.png',
    reader_nova_005: 'assets/scout-badges/reader_discovery_plus2_025.png',
    reader_low_rank_050: 'assets/scout-badges/reader_new_author_100.png',
    reader_low_rank_100: 'assets/scout-badges/reader_genre_010.png',
    reader_new_work_050: 'assets/scout-badges/reader_genre_030.png',
    reader_new_work_100: 'assets/scout-badges/reader_new_work_010.png',
    reader_genre_008: 'assets/scout-badges/reader_new_work_025.png',
    reader_long_read_005: 'assets/scout-badges/reader_low_rank_025.png',
    reader_long_read_010: 'assets/scout-badges/reader_series_complete_001.png',
    reader_short_read_010: 'assets/scout-badges/reader_series_complete_003.png',
    reader_short_read_025: 'assets/scout-badges/reader_series_complete_005.png',
    reader_read_1000: 'assets/scout-badges/hard_reader_read_1000.png',
    reader_new_author_250: 'assets/scout-badges/hard_reader_new_author_250.png',
    reader_low_rank_250: 'assets/scout-badges/hard_reader_low_rank_250.png',
    reader_low_rank_500: 'assets/scout-badges/hard_reader_low_rank_500.png',
    reader_discovery_plus3_025: 'assets/scout-badges/hard_reader_discovery_plus3_025.png',
    reader_discovery_plus3_050: 'assets/scout-badges/hard_reader_discovery_plus3_050.png',
    reader_discovery_plus4_010: 'assets/scout-badges/hard_reader_discovery_plus4_010.png',
    reader_discovery_plus4_020: 'assets/scout-badges/hard_reader_discovery_plus4_020.png',
    reader_discovery_plus5_001: 'assets/scout-badges/hard_reader_discovery_plus5_001.png',
    reader_discovery_plus5_003: 'assets/scout-badges/hard_reader_discovery_plus5_003.png',
    reader_discovery_plus5_010: 'assets/scout-badges/hard_reader_discovery_plus5_010.png',
    reader_nova_010: 'assets/scout-badges/hard_reader_nova_010.png',
    reader_nova_025: 'assets/scout-badges/hard_reader_nova_025.png',
    reader_gold_plus5_001: 'assets/scout-badges/hard_reader_gold_plus5_001.png',
    reader_silver_plus5_001: 'assets/scout-badges/hard_reader_silver_plus5_001.png',
    reader_bronze_plus5_001: 'assets/scout-badges/hard_reader_bronze_plus5_001.png',
    reader_master_scout: 'assets/scout-badges/hard_reader_master_scout.png',
    author_chars_1m: 'assets/scout-badges/hard_author_chars_1m.png',
    author_completed_010: 'assets/scout-badges/hard_author_completed_010.png',
    author_unique_reader_1000: 'assets/scout-badges/hard_author_unique_reader_1000.png',
    author_favorite_500: 'assets/scout-badges/hard_author_favorite_500.png',
    author_discovered_plus2_005: 'assets/scout-badges/hard_author_discovered_plus2_005.png'
  };

  function titleArtworkPath(title) {
    const badgeId = String(title?.badge_id || '');
    if (!/^(?:reader|author|limited)_[a-z0-9_]+$/u.test(badgeId)) return null;
    if (badgeId === 'limited_founding_author') {
      return 'assets/founding-authors-badge-2026.png';
    }
    return badgeArtworkOverrides[badgeId] || `assets/scout-badges/${badgeId}.png`;
  }

  function optimizedArtworkPath(path) {
    const source = String(path || '').trim();
    if (!source) return source;
    return `/_vercel/image?url=${encodeURIComponent('/' + source.replace(/^\/+/, ''))}&w=${EQUIPPED_BADGE_WIDTH}&q=${EQUIPPED_BADGE_QUALITY}`;
  }

  function mountEquippedTitle(title) {
    if (!title || !profileHost) return;

    const mount = () => {
      const name = profileHost.querySelector('.name');
      if (!name || profileHost.querySelector('.public-profile-equipped-title')) {
        return false;
      }

      const badge = document.createElement('div');
      badge.className = 'public-profile-equipped-title';
      badge.setAttribute('aria-label', `装備称号 ${title.display_name || ''}`);

      const artworkWrap = document.createElement('span');
      artworkWrap.className = 'public-profile-equipped-artwork';
      artworkWrap.setAttribute('aria-hidden', 'true');

      const fallback = document.createElement('span');
      fallback.className = 'public-profile-equipped-fallback';
      fallback.textContent = '✦';
      artworkWrap.appendChild(fallback);

      const artworkPath = titleArtworkPath(title);
      if (artworkPath) {
        const image = document.createElement('img');
        image.dataset.novelightOriginalSrc = artworkPath;
        image.src = optimizedArtworkPath(artworkPath);
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        if ('fetchPriority' in image) image.fetchPriority = 'low';
        image.width = 120;
        image.height = 120;
        image.addEventListener('load', () => {
          artworkWrap.classList.add('has-artwork');
        });
        image.addEventListener('error', () => {
          if (image.dataset.novelightTriedOriginal !== 'true') {
            image.dataset.novelightTriedOriginal = 'true';
            image.src = artworkPath;
            return;
          }
          image.remove();
          artworkWrap.classList.remove('has-artwork');
        });
        artworkWrap.prepend(image);
      }

      // Group the equipped badge with its title at the right of the pen name.
      const titleName = document.createElement('strong');
      titleName.className = 'public-profile-equipped-name';
      titleName.textContent = title.display_name || '称号';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'public-profile-equipped-group';
      badge.appendChild(artworkWrap);
      titleGroup.append(badge, titleName);
      name.insertAdjacentElement('afterend', titleGroup);
      profileHost.classList.add('has-equipped-title');
      return true;
    };

    if (mount()) return;

    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(profileHost, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);
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

      mountEquippedTitle(equippedTitle);

      if (!host) return;
      const rankArtwork = rankArtworkPaths[tier];
      host.innerHTML = `
        <div class="public-scout-head">
          <div>
            <h2>SCOUT RECORD</h2>
            <p>公開されている発掘実績</p>
          </div>
        </div>
        <div class="public-scout-summary">
          <div class="public-scout-kv"><span>Scout Level</span><strong>Lv.${level.toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-rank">
            <div class="public-scout-emblem">
              <span class="public-scout-rank-fallback" aria-hidden="true">${esc(rankNames[tier].slice(0, 1))}</span>
              <img class="public-scout-rank-image" src="${esc(optimizedArtworkPath(rankArtwork))}" alt="${esc(rankNames[tier])}のランクバッジ" width="96" height="96" loading="lazy" decoding="async">
            </div>
            <strong>${esc(rankNames[tier])}</strong>
          </div>
        </div>
        ${discoveries.length ? `<div class="public-scout-label">代表的な発掘実績</div><div class="public-scout-discoveries">${discoveries.map((item) => `<span class="public-scout-discovery">${esc(item.title || '作品')} · ${item.nova_prediction ? 'NOVA' : '+' + Number(item.rank_delta || 0) + ' Rank'}</span>`).join('')}</div>` : ''}
      `;
      const rankImage = host.querySelector('.public-scout-rank-image');
      if (rankImage) {
        rankImage.addEventListener('load', () => {
          rankImage.parentElement.classList.add('has-rank-artwork');
        });
        rankImage.addEventListener('error', () => {
          if (rankImage.dataset.triedOriginal !== 'true') {
            rankImage.dataset.triedOriginal = 'true';
            rankImage.src = rankArtwork;
            return;
          }
          rankImage.remove();
        });
        if (rankImage.complete) {
          if (rankImage.naturalWidth > 0) {
            rankImage.parentElement.classList.add('has-rank-artwork');
          } else {
            rankImage.dataset.triedOriginal = 'true';
            rankImage.src = rankArtwork;
          }
        }
      }
      host.hidden = false;
    } catch (error) {
      console.error('Public SCOUT RECORD unavailable', error);
    }
  })();
})();
