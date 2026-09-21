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

  function badgeIcon(row) {
    if (row.badge_category === 'limited') return '✦';
    if (row.badge_category === 'author') return '✒';
    return '◇';
  }

  function badgeVisible(row) {
    if (badgeCategory !== 'all' && row.badge_category !== badgeCategory) {
      return false;
    }
    const earned = row.status === 'earned';
    if (badgeStatus === 'earned' && !earned) return false;
    if (badgeStatus === 'unearned' && earned) return false;
    return true;
  }

  function filteredBadges() {
    return badgeRows.filter(badgeVisible);
  }

  function renderBadges() {
    const host = document.getElementById('badgeGrid');
    if (!host) return;
    host.replaceChildren();

    const rows = filteredBadges();
    const earnedCount = badgeRows.filter((row) => row.status === 'earned').length;
    setText('statBadges', n(earnedCount));
    setText('badgeCount', `${earnedCount} / ${badgeRows.length}`);

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'badge-empty';
      empty.style.gridColumn = '1 / -1';
      empty.textContent =
        badgeCategory === 'reader'
          ? 'Reader Badge 100件の個別条件は、採用済みの元リストを復元後に有効化します。条件を推測して作成することはしません。'
          : 'この条件に該当するBadgeはまだありません。';
      host.appendChild(empty);
      return;
    }

    rows.forEach((row) => {
      const earned = row.status === 'earned';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `badge-card ${row.difficulty || ''} ${earned ? 'earned' : 'unearned'}`;
      if (row.badge_category === 'limited') card.classList.add('limited');
      card.dataset.badgeId = row.badge_id;

      const icon = document.createElement('div');
      icon.className = 'badge-icon';
      icon.textContent = badgeIcon(row);

      const title = document.createElement('h3');
      title.textContent = row.display_name;

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
      host.appendChild(card);
    });
  }

  function openBadge(row) {
    const dialog = document.getElementById('badgeDialog');
    if (!dialog) return;
    setText('badgeDialogName', row.display_name);
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

    const [summary, points, activity, discoveries, badges] = await Promise.all([
      client.rpc('novelight_scout_record_summary'),
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
