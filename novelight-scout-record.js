(() => {
  if (!window.supabase) return;

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );

  const rankRoman = ['', 'I', 'II', 'III'];
  const rankBands = [
    { tier: 1, level: 'Lv.1–10', name: 'RANK I' },
    { tier: 2, level: 'Lv.11–20', name: 'RANK II' },
    { tier: 3, level: 'Lv.21–30', name: 'RANK III' }
  ];
  const categoryLabels = {
    reader: '読者',
    author: '作者',
    limited: '限定'
  };
  const difficultyLabels = {
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
    special: 'Special'
  };
  const activityLabels = {
    valid_read: '有効読書',
    light_seed_sent: 'LIGHT SEED',
    light_seed_discovery: '発掘成功',
    star_rating_set: '☆評価',
    comment_posted: 'コメント'
  };
  const badgeArtworkPaths = {
    limited_founding_author: 'assets/founding-authors-badge-2026.png',
    reader_read_001: 'assets/scout-reader-easy/reader_read_001.png',
    reader_read_005: 'assets/scout-reader-easy/reader_read_005.png',
    reader_read_010: 'assets/scout-reader-easy/reader_read_010.png',
    reader_read_025: 'assets/scout-reader-easy/reader_read_025.png',
    reader_rating_001: 'assets/scout-reader-easy/reader_rating_001.png',
    reader_rating_005: 'assets/scout-reader-easy/reader_rating_005.png',
    reader_rating_010: 'assets/scout-reader-easy/reader_rating_010.png',
    reader_comment_001: 'assets/scout-reader-easy/reader_comment_001.png',
    reader_comment_005: 'assets/scout-reader-easy/reader_comment_005.png',
    reader_comment_010: 'assets/scout-reader-easy/reader_comment_010.png',
    reader_seed_001: 'assets/scout-reader-easy/reader_seed_001.png',
    reader_seed_003: 'assets/scout-reader-easy/reader_seed_003.png',
    reader_seed_005: 'assets/scout-reader-easy/reader_seed_005.png',
    reader_seed_010: 'assets/scout-reader-easy/reader_seed_010.png',
    reader_bronze_seed_001: 'assets/scout-reader-easy/reader_bronze_seed_001.png',
    reader_silver_seed_001: 'assets/scout-reader-easy/reader_silver_seed_001.png',
    reader_gold_seed_001: 'assets/scout-reader-easy/reader_gold_seed_001.png',
    reader_discovery_plus2_001: 'assets/scout-reader-easy/reader_discovery_plus2_001.png',
    reader_discovery_plus2_002: 'assets/scout-reader-easy/reader_discovery_plus2_002.png',
    reader_discovery_plus2_003: 'assets/scout-reader-easy/reader_discovery_plus2_003.png',
    reader_new_author_005: 'assets/scout-reader-easy/reader_new_author_005.png',
    reader_new_author_010: 'assets/scout-reader-easy/reader_new_author_010.png',
    reader_genre_003: 'assets/scout-reader-easy/reader_genre_003.png',
    reader_genre_005: 'assets/scout-reader-easy/reader_genre_005.png',
    reader_new_work_005: 'assets/scout-reader-easy/reader_new_work_005.png',
    reader_low_rank_005: 'assets/scout-reader-easy/reader_low_rank_005.png',
    reader_level_005: 'assets/scout-reader-easy/reader_level_005.png',
    reader_level_010: 'assets/scout-reader-easy/reader_level_010.png',
    reader_level_020: 'assets/scout-reader-easy/reader_level_020.png',
    reader_active_days_007: 'assets/scout-reader-easy/reader_active_days_007.png'
  };

  let badgeRows = [];
  let badgeCategory = 'all';
  let badgeStatus = 'all';

  function n(value) {
    return Number(value || 0).toLocaleString('ja-JP');
  }

  function dateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleString('ja-JP', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setState(message, error = false) {
    const node = document.getElementById('scoutState');
    if (!node) return;
    node.classList.toggle('scout-error', error);
    node.textContent = message;
  }

  function setLevelProgress(summary) {
    const maxed = Boolean(summary.beta_level_max);
    const into = Number(summary.xp_into_level || 0);
    const needed = Number(summary.xp_for_next_level || 0);
    const percent = maxed
      ? 100
      : needed > 0
        ? Math.max(0, Math.min(100, (into / needed) * 100))
        : 0;
    const bar = document.getElementById('levelProgressBar');
    const track = document.getElementById('levelProgressTrack');
    if (bar) bar.style.width = `${percent.toFixed(1)}%`;
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
    setText(
      'levelProgressText',
      maxed ? 'β LEVEL MAX' : `${n(into)} / ${n(needed)} XP`
    );
    const notice = document.getElementById('levelMaxNotice');
    if (notice) notice.hidden = !maxed;
  }

  function renderRankPath(tier) {
    const host = document.getElementById('rankPath');
    if (!host) return;
    host.replaceChildren();

    rankBands.forEach((band, index) => {
      const node = document.createElement('div');
      node.className = 'rank-node';
      if (band.tier < tier) node.classList.add('past');
      if (band.tier === tier) node.classList.add('current');

      const orb = document.createElement('div');
      orb.className = 'rank-orb';
      orb.textContent = rankRoman[band.tier];

      const copy = document.createElement('div');
      copy.className = 'rank-node-copy';
      const strong = document.createElement('b');
      strong.textContent = band.name;
      const level = document.createElement('span');
      level.textContent = band.level;
      copy.append(strong, level);
      node.append(orb, copy);
      host.appendChild(node);

      if (index < rankBands.length - 1) {
        const line = document.createElement('div');
        line.className = 'rank-line';
        host.appendChild(line);
      }
    });
  }

  function renderSummary(summary) {
    const level = Math.max(1, Number(summary.level || 1));
    const tier = Math.max(1, Math.min(3, Number(summary.rank_tier || 1)));
    setText('rankName', `SCOUT RANK ${rankRoman[tier]}`);
    setText('rankLevel', `Lv.${n(level)}`);
    setText('rankEmblem', rankRoman[tier]);
    setText('xpNow', n(summary.total_xp));
    setText(
      'xpNext',
      summary.beta_level_max
        ? 'β上限到達'
        : `次Lv. ${n(summary.next_level_xp)} XP`
    );
    setText('pointBalance', n(summary.point_balance));
    setText('monthPoint', `+${n(summary.month_points)} pt`);
    setText('pendingPoint', n(summary.pending_points));
    setText('statSeeds', n(summary.light_seed_count));
    setText('statDiscoveries', n(summary.discovery_success_count));
    setText('statPoint', n(summary.point_balance));
    setLevelProgress(summary);
    renderRankPath(tier);
  }

  function renderSeedInventory(inventory) {
    const goldAllocated = Math.max(0, Number(inventory.gold_allocated ?? 6));
    const silverAllocated = Math.max(0, Number(inventory.silver_allocated ?? 3));
    const bronzeAllocated = Math.max(0, Number(inventory.bronze_allocated ?? 2));
    const monthlyLimit = Math.max(
      0,
      Number(inventory.monthly_limit ?? goldAllocated + silverAllocated + bronzeAllocated)
    );
    const remaining = Math.max(0, Number(inventory.remaining_this_month ?? 0));

    setText('seedInventoryTotal', `${n(remaining)} / ${n(monthlyLimit)}`);
    setText('seedGoldRemaining', n(inventory.gold_remaining));
    setText('seedGoldAllocated', n(goldAllocated));
    setText('seedSilverRemaining', n(inventory.silver_remaining));
    setText('seedSilverAllocated', n(silverAllocated));
    setText('seedBronzeRemaining', n(inventory.bronze_remaining));
    setText('seedBronzeAllocated', n(bronzeAllocated));

    const legacy = Math.max(0, Number(inventory.legacy_used || 0));
    const note = document.getElementById('seedInventoryLegacyNote');
    if (note) {
      note.hidden = legacy === 0;
      note.textContent = legacy
        ? `旧仕様LIGHT SEEDの使用 ${n(legacy)}件を今月合計に含みます。`
        : '';
    }
  }

  function renderSeedInventoryError() {
    setText('seedInventoryTotal', '取得エラー');
    for (const id of [
      'seedGoldRemaining',
      'seedSilverRemaining',
      'seedBronzeRemaining'
    ]) {
      setText(id, '—');
    }
  }

  function badgeIcon(row) {
    if (row.badge_category === 'limited') return '✦';
    if (row.badge_category === 'author') return '✒';
    return '◇';
  }

  function badgeDisplayName(row) {
    if (row.badge_id !== 'limited_founding_author') return row.display_name;
    const foundingNumber = Number(row?.metadata?.founding_number);
    if (!Number.isInteger(foundingNumber) || foundingNumber < 1) {
      return row.display_name;
    }
    return `Founding Author #${String(foundingNumber).padStart(3, '0')}`;
  }

  function createBadgeIcon(row) {
    const icon = document.createElement('div');
    icon.className = 'badge-icon';

    const artworkPath = badgeArtworkPaths[row.badge_id];
    if (!artworkPath) {
      icon.textContent = badgeIcon(row);
      return icon;
    }

    icon.classList.add('badge-icon-artwork');
    const image = document.createElement('img');
    image.src = artworkPath;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    icon.appendChild(image);
    return icon;
  }

  function renderBadgeDialogArtwork(row) {
    const host = document.getElementById('badgeDialogArtwork');
    const image = document.getElementById('badgeDialogArtworkImage');
    if (!host || !image) return;

    image.removeAttribute('src');
    image.alt = '';

    const artworkPath = badgeArtworkPaths[row.badge_id];
    host.hidden = !artworkPath;
    if (!artworkPath) return;

    image.src = artworkPath;
    image.alt = `${badgeDisplayName(row)} 称号`;
  }

  const badgeGroupDefinitions = [
    { key: 'easy', hostId: 'badgeGridEasy', countId: 'badgeGroupEasyCount' },
    { key: 'normal', hostId: 'badgeGridNormal', countId: 'badgeGroupNormalCount' },
    { key: 'hard', hostId: 'badgeGridHard', countId: 'badgeGroupHardCount' },
    { key: 'special', hostId: 'badgeGridSpecial', countId: 'badgeGroupSpecialCount' }
  ];

  function badgeMatchesCategory(row) {
    return badgeCategory === 'all' || row.badge_category === badgeCategory;
  }

  function badgeVisible(row) {
    if (!badgeMatchesCategory(row)) return false;
    const earned = row.status === 'earned';
    if (badgeStatus === 'earned' && !earned) return false;
    if (badgeStatus === 'unearned' && earned) return false;
    return true;
  }

  function badgeGroupKey(row) {
    return ['easy', 'normal', 'hard'].includes(row.difficulty)
      ? row.difficulty
      : 'special';
  }

  function createBadgeCard(row) {
    const earned = row.status === 'earned';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `badge-card ${row.difficulty || ''} ${earned ? 'earned' : 'unearned'}`;
    if (row.badge_category === 'limited') card.classList.add('limited');
    card.dataset.badgeId = row.badge_id;

    const icon = createBadgeIcon(row);

    const title = document.createElement('h3');
    title.textContent = badgeDisplayName(row);

    const meta = document.createElement('div');
    meta.className = 'badge-meta';
    const category = document.createElement('span');
    category.textContent = categoryLabels[row.badge_category] || row.badge_category;
    const difficulty = document.createElement('span');
    difficulty.textContent =
      difficultyLabels[row.difficulty] || row.difficulty || '';
    meta.append(category, difficulty);

    const progress = document.createElement('div');
    progress.className = 'badge-progress';
    const progressBar = document.createElement('span');
    progressBar.style.width = `${Math.max(0, Math.min(100, Number(row.progress_percent || 0)))}%`;
    progress.appendChild(progressBar);

    const progressText = document.createElement('div');
    progressText.className = 'badge-progress-text';
    const values = document.createElement('span');
    values.textContent = `${n(row.progress_value)} / ${n(row.target_value)}`;
    const percent = document.createElement('span');
    percent.textContent = `${Number(row.progress_percent || 0).toFixed(0)}%`;
    progressText.append(values, percent);

    const point = document.createElement('div');
    point.className = 'badge-point';
    point.textContent =
      Number(row.point_reward || 0) > 0
        ? `報酬 +${n(row.point_reward)} pt`
        : row.badge_category === 'author'
          ? 'Author Badge / Point報酬なし'
          : earned
            ? '獲得済み'
            : 'Point報酬なし';

    card.append(icon, title, meta, progress, progressText, point);
    card.addEventListener('click', () => openBadge(row));
    return card;
  }

  function renderBadges() {
    const visibleRows = badgeRows.filter(badgeVisible);
    const earnedCount = badgeRows.filter((row) => row.status === 'earned').length;
    setText('statBadges', n(earnedCount));
    setText('badgeCount', `${earnedCount} / ${badgeRows.length}`);

    const empty = document.getElementById('badgeEmpty');
    if (empty) empty.hidden = visibleRows.length > 0;

    badgeGroupDefinitions.forEach((group) => {
      const details = document.querySelector(`[data-badge-group="${group.key}"]`);
      const host = document.getElementById(group.hostId);
      if (!details || !host) return;

      const baseRows = badgeRows.filter(
        (row) => badgeMatchesCategory(row) && badgeGroupKey(row) === group.key
      );
      const rows = visibleRows.filter((row) => badgeGroupKey(row) === group.key);
      const groupEarned = baseRows.filter((row) => row.status === 'earned').length;

      setText(group.countId, `${groupEarned} / ${baseRows.length} 獲得`);
      details.hidden = rows.length === 0;
      host.replaceChildren();
      rows.forEach((row) => host.appendChild(createBadgeCard(row)));
    });
  }

  function renderCompositeProgress(row) {
    const host = document.getElementById('badgeDialogComposite');
    if (!host) return;
    host.replaceChildren();

    const components = Array.isArray(row?.metadata?.composite_progress)
      ? row.metadata.composite_progress
      : [];
    host.hidden = components.length === 0;
    if (!components.length) return;

    const heading = document.createElement('h3');
    heading.textContent = '個別条件の進捗';
    host.appendChild(heading);

    components.forEach((component) => {
      const current = Number(component?.current || 0);
      const target = Math.max(1, Number(component?.target || 1));
      const percent = Math.max(
        0,
        Math.min(100, Number(component?.percent || 0))
      );

      const item = document.createElement('div');
      item.className = 'badge-composite-item';

      const line = document.createElement('div');
      line.className = 'badge-composite-line';
      const label = document.createElement('b');
      label.textContent = component?.label || component?.metric_key || '条件';
      const value = document.createElement('span');
      value.textContent = `${n(current)} / ${n(target)} · ${percent.toFixed(0)}%`;
      line.append(label, value);

      const meter = document.createElement('div');
      meter.className = 'badge-progress badge-composite-meter';
      const fill = document.createElement('span');
      fill.style.width = `${percent.toFixed(1)}%`;
      meter.appendChild(fill);

      item.append(line, meter);
      host.appendChild(item);
    });
  }

  function openBadge(row) {
    const dialog = document.getElementById('badgeDialog');
    if (!dialog) return;
    setText('badgeDialogName', badgeDisplayName(row));
    renderBadgeDialogArtwork(row);
    setText('badgeDialogCategory', categoryLabels[row.badge_category] || row.badge_category);
    setText('badgeDialogDifficulty', difficultyLabels[row.difficulty] || row.difficulty);
    setText('badgeDialogCondition', row.description);
    setText('badgeDialogProgress', `${n(row.progress_value)} / ${n(row.target_value)}`);
    setText('badgeDialogPercent', `${Number(row.progress_percent || 0).toFixed(0)}%`);
    setText(
      'badgeDialogReward',
      Number(row.point_reward || 0) > 0
        ? `+${n(row.point_reward)} Scout Point`
        : 'なし'
    );
    setText('badgeDialogEarned', row.earned_at ? dateTime(row.earned_at) : '未獲得');

    const bar = document.getElementById('badgeDialogBar');
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, Number(row.progress_percent || 0)))}%`;
    }
    renderCompositeProgress(row);

    const visibility = document.getElementById('badgeVisibility');
    const visibilityButton = document.getElementById('badgeVisibilityButton');
    if (visibility && visibilityButton) {
      visibility.hidden = row.status !== 'earned';
      visibilityButton.dataset.badgeId = row.badge_id;
      visibilityButton.dataset.public = String(Boolean(row.is_public));
      visibilityButton.textContent = row.is_public
        ? '公開Badgeから外す'
        : '公開Badgeにする';
    }

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function renderPoints(rows) {
    const host = document.getElementById('pointHistory');
    if (!host) return;
    host.replaceChildren();
    if (!rows.length) {
      host.innerHTML = '<div class="scout-empty">まだScout Pointの獲得履歴はありません。</div>';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'scout-row';
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = row.reason || 'Scout Point';
      const meta = document.createElement('small');
      const state =
        row.status === 'pending' || row.status === 'frozen'
          ? '確認中'
          : row.status === 'cancelled'
            ? '取消'
            : '確定';
      meta.textContent = `${dateTime(row.occurred_at)} · ${state}`;
      copy.append(title, meta);
      const value = document.createElement('strong');
      const amount = Number(row.point_value || 0);
      value.textContent = `${amount >= 0 ? '+' : ''}${n(amount)} pt`;
      item.append(copy, value);
      host.appendChild(item);
    });
  }

  function renderActivity(rows) {
    const host = document.getElementById('activityList');
    if (!host) return;
    host.replaceChildren();
    setText('statActivity', n(rows.length));
    if (!rows.length) {
      host.innerHTML = '<div class="scout-empty">まだ表示できるSCOUT活動はありません。</div>';
      return;
    }
    rows.slice(0, 12).forEach((row) => {
      const item = document.createElement('div');
      item.className = 'scout-row';
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `${activityLabels[row.event_type] || 'SCOUT活動'} · ${row.novel_title || '作品情報は現在非公開'}`;
      const meta = document.createElement('small');
      meta.textContent = dateTime(row.occurred_at);
      copy.append(title, meta);
      item.appendChild(copy);
      host.appendChild(item);
    });
  }

  function renderSeedHistory(rows, novelMap, metadataUnavailable = false) {
    const host = document.getElementById('seedHistoryList');
    if (!host) return;
    host.replaceChildren();
    setText('seedHistoryCount', `${n(rows.length)}件`);

    if (!rows.length) {
      host.innerHTML =
        '<div class="scout-empty">まだLIGHT SEEDを贈った作品はありません。</div>';
      return;
    }

    rows.forEach((row) => {
      const id = String(row.novel_id_snapshot || '');
      const novel = novelMap.get(id);
      const published = !metadataUnavailable && novel?.status === 'published';

      const item = document.createElement('div');
      item.className = 'scout-row';
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = metadataUnavailable
        ? '作品情報を取得できません'
        : published
          ? novel.title
          : '現在表示できない作品';
      const meta = document.createElement('small');
      meta.textContent = `LIGHT SEEDを贈った日時：${dateTime(row.seeded_at)} · ${
        metadataUnavailable
          ? '作品情報の取得エラー'
          : published
            ? '公開中'
            : '現在非公開または削除済み'
      }`;
      copy.append(title, meta);
      item.appendChild(copy);

      if (published) {
        const link = document.createElement('a');
        link.className = 'scout-mini-button';
        link.href = `novel.html?id=${encodeURIComponent(id)}`;
        link.textContent = '作品を見る →';
        item.appendChild(link);
      } else {
        const state = document.createElement('strong');
        state.textContent = metadataUnavailable ? '再読み込み' : '表示不可';
        item.appendChild(state);
      }

      host.appendChild(item);
    });
  }

  async function loadSeedHistory() {
    const host = document.getElementById('seedHistoryList');
    if (!host) return;

    let rows;
    try {
      const result = await client
        .from('light_seeds')
        .select('novel_id_snapshot,seeded_at')
        .order('seeded_at', { ascending: false });
      if (result.error) throw result.error;
      rows = result.data || [];
    } catch (error) {
      console.error(error);
      setText('seedHistoryCount', '—');
      host.innerHTML =
        '<div class="scout-error">LIGHT SEED送信履歴を読み込めませんでした。</div>';
      return;
    }

    if (!rows.length) {
      renderSeedHistory([], new Map());
      return;
    }

    const ids = [...new Set(rows.map((row) => String(row.novel_id_snapshot)))];
    try {
      const result = await client
        .from('novels')
        .select('id,title,status')
        .in('id', ids);
      if (result.error) throw result.error;
      renderSeedHistory(
        rows,
        new Map((result.data || []).map((row) => [String(row.id), row]))
      );
    } catch (error) {
      console.error(error);
      renderSeedHistory(rows, new Map(), true);
    }
  }

  function renderDiscoveries(rows) {
    const host = document.getElementById('discoveriesList');
    if (!host) return;
    host.replaceChildren();
    if (!rows.length) {
      host.innerHTML = '<div class="scout-empty">発掘成功に到達した作品はまだありません。</div>';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'scout-row';
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = row.novel_title || '現在表示できない作品';
      const meta = document.createElement('small');
      meta.textContent = `${row.seed_type || 'SEED'} · 送信時 Rank ${n(row.rank_at_seed)} → 最高 Rank ${n(row.highest_rank_seen)}`;
      copy.append(title, meta);
      const value = document.createElement('strong');
      value.textContent =
        Number(row.rank_at_seed) === 5 && Number(row.highest_rank_seen) === 6
          ? 'NOVA'
          : `+${n(row.best_rank_delta)} Rank`;
      item.append(copy, value);
      host.appendChild(item);
    });
  }

  function bindFilters() {
    document.querySelectorAll('[data-badge-category]').forEach((button) => {
      button.addEventListener('click', () => {
        badgeCategory = button.dataset.badgeCategory || 'all';
        document.querySelectorAll('[data-badge-category]').forEach((item) => {
          item.setAttribute('aria-pressed', String(item === button));
        });
        renderBadges();
      });
    });
    document.querySelectorAll('[data-badge-status]').forEach((button) => {
      button.addEventListener('click', () => {
        badgeStatus = button.dataset.badgeStatus || 'all';
        document.querySelectorAll('[data-badge-status]').forEach((item) => {
          item.setAttribute('aria-pressed', String(item === button));
        });
        renderBadges();
      });
    });
  }

  function bindDialogs() {
    document.querySelectorAll('[data-dialog-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = button.closest('dialog');
        if (dialog?.close) dialog.close();
        else dialog?.removeAttribute('open');
      });
    });

    const help = document.getElementById('scoutHelp');
    const helpDialog = document.getElementById('scoutHelpDialog');
    help?.addEventListener('click', () => {
      if (helpDialog?.showModal) helpDialog.showModal();
      else helpDialog?.setAttribute('open', '');
    });

    const visibility = document.getElementById('badgeVisibilityButton');
    visibility?.addEventListener('click', async () => {
      const badgeId = visibility.dataset.badgeId;
      if (!badgeId) return;
      const next = visibility.dataset.public !== 'true';
      visibility.disabled = true;
      try {
        const { data, error } = await client.rpc(
          'novelight_set_scout_badge_visibility',
          { p_badge_id: badgeId, p_is_public: next }
        );
        if (error) throw error;
        if (!data) throw new Error('Badge visibility was not updated');
        const row = badgeRows.find((badge) => badge.badge_id === badgeId);
        if (row) row.is_public = next;
        visibility.dataset.public = String(next);
        visibility.textContent = next ? '公開Badgeから外す' : '公開Badgeにする';
      } catch (error) {
        console.error(error);
        visibility.textContent = '公開設定を変更できませんでした';
      } finally {
        visibility.disabled = false;
      }
    });
  }

  async function load() {
    void window.NovelightClient?.recordVisit?.(client);

    let session;
    try {
      const auth = await client.auth.getSession();
      if (auth.error) throw auth.error;
      session = auth.data.session;
    } catch (error) {
      console.error(error);
      setState('ログイン状態を確認できませんでした。', true);
      return;
    }

    if (!session) {
      window.location.href = 'login.html?redirect=scout-record.html';
      return;
    }

    void window.NovelightClient?.claimAcquisition?.(client);
    void Promise.resolve(client.rpc('novelight_record_scout_record_visit'))
      .then(({ error }) => {
        if (error) console.error('SCOUT RECORD usage telemetry failed', error);
      })
      .catch((error) =>
        console.error('SCOUT RECORD usage telemetry failed', error)
      );

    void loadSeedHistory();

    const [summary, inventory, points, activity, discoveries, badges] =
      await Promise.all([
        client.rpc('novelight_scout_record_summary'),
        client.rpc('novelight_light_seed_inventory'),
        client.rpc('novelight_scout_point_history', { p_limit: 30 }),
        client.rpc('novelight_scout_recent_activity', { p_limit: 20 }),
        client.rpc('novelight_scout_discoveries', { p_limit: 20 }),
        client.rpc('novelight_scout_badges')
      ]);

    if (summary.error) {
      console.error(summary.error);
      setState('SCOUT RECORDを読み込めませんでした。時間をおいて再度お試しください。', true);
      return;
    }

    renderSummary(summary.data || {});
    setState('SCOUT RECORD β版の現在値です。');

    if (inventory.error) {
      console.error(inventory.error);
      renderSeedInventoryError();
    } else {
      renderSeedInventory(inventory.data || {});
    }

    if (points.error) console.error(points.error);
    renderPoints(points.error ? [] : points.data || []);

    if (activity.error) console.error(activity.error);
    renderActivity(activity.error ? [] : activity.data || []);

    if (discoveries.error) console.error(discoveries.error);
    renderDiscoveries(discoveries.error ? [] : discoveries.data || []);

    if (badges.error) {
      console.error(badges.error);
      const host = document.getElementById('badgeGrid');
      if (host) {
        host.innerHTML =
          '<div class="scout-error" style="grid-column:1/-1">Badgeを読み込めませんでした。</div>';
      }
    } else {
      badgeRows = badges.data || [];
      renderBadges();
    }
  }

  bindFilters();
  bindDialogs();
  void load();
})();