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

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function titleArtworkPath(title) {
    const badgeId = String(title?.badge_id || '');
    if (!badgeId) return null;
    if (badgeId === 'limited_founding_author') {
      return 'assets/founding-authors-badge-2026.png';
    }
    if (/^reader_[a-z0-9_]+$/u.test(badgeId)) {
      return `assets/scout-badges/${badgeId}.png`;
    }
    return null;
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
        image.src = artworkPath;
        image.alt = '';
        image.loading = 'eager';
        image.decoding = 'async';
        image.addEventListener('load', () => {
          artworkWrap.classList.add('has-artwork');
        });
        image.addEventListener('error', () => {
          image.remove();
          artworkWrap.classList.remove('has-artwork');
        });
        artworkWrap.prepend(image);
      }

      const copy = document.createElement('span');
      copy.className = 'public-profile-equipped-copy';

      const label = document.createElement('small');
      label.textContent = '装備称号';

      const titleName = document.createElement('strong');
      titleName.textContent = title.display_name || '称号';

      copy.append(label, titleName);
      badge.append(artworkWrap, copy);
      name.insertAdjacentElement('afterend', badge);
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
      host.innerHTML = `
        <div class="public-scout-head">
          <div>
            <h2>SCOUT RECORD</h2>
            <p>公開されている発掘実績</p>
          </div>
          <div class="public-scout-rank">
            <div class="public-scout-emblem">${esc(rankNames[tier].slice(0, 1))}</div>
            <strong>SCOUT RANK — ${esc(rankNames[tier])}</strong>
          </div>
        </div>
        <div class="public-scout-summary">
          <div class="public-scout-kv"><span>Scout Level</span><strong>Lv.${level.toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>発掘成功</span><strong>${Number(data.discovery_success_count || 0).toLocaleString('ja-JP')}</strong></div>
          <div class="public-scout-kv"><span>装備称号</span><strong>${equippedTitle ? esc(equippedTitle.display_name) : '—'}</strong></div>
        </div>
        ${equippedTitle ? `<div class="public-scout-label">装備称号</div><div class="public-scout-badges"><span class="public-scout-badge">${esc(equippedTitle.display_name)}</span></div>` : ''}
        ${discoveries.length ? `<div class="public-scout-label">代表的な発掘実績</div><div class="public-scout-discoveries">${discoveries.map((item) => `<span class="public-scout-discovery">${esc(item.title || '作品')} · ${item.nova_prediction ? 'NOVA' : '+' + Number(item.rank_delta || 0) + ' Rank'}</span>`).join('')}</div>` : ''}
      `;
      host.hidden = false;
    } catch (error) {
      console.error('Public SCOUT RECORD unavailable', error);
    }
  })();
})();
