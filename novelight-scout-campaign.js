(() => {
  function installCanonicalPublicHeader() {
    document.body?.classList.add('novelight-public-header-page');

    if (!document.querySelector('link[data-novelight-public-header]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'novelight-header-light.css';
      link.dataset.novelightPublicHeader = 'shared';
      document.head.appendChild(link);
    }

    const header = document.querySelector('header.site-header, header');
    if (!header) return;

    header.className = 'site-header';
    header.innerHTML =
      '<div class="header-inner public-header-inner">' +
      '<a class="logo" href="index.html" aria-label="NOVELIGHT ホーム"><img src="assets/novelight-header-logo.webp" alt="NOVELIGHT"></a>' +
      '<nav class="site-nav desktop-nav" aria-label="メインナビ">' +
      '<a href="search.html">作品を探す</a>' +
      '<a href="index.html#features">特徴</a>' +
      '<a href="pricing.html">料金プラン</a>' +
      '<a href="ranking.html">ランキング</a>' +
      '</nav>' +
      '<div class="header-actions">' +
      '<a class="header-search" href="search.html" aria-label="作品を検索"><span aria-hidden="true">⌕</span></a>' +
      '<a id="campaignHeaderLogin" class="btn btn-outline login-action" href="login.html">ログイン</a>' +
      '<a id="campaignHeaderSignup" class="btn btn-primary signup-action" href="signup.html">会員登録</a>' +
      '<details class="mobile-menu"><summary aria-label="メニューを開く">☰</summary><nav aria-label="モバイルナビ">' +
      '<a href="search.html">作品を探す</a>' +
      '<a href="index.html#features">特徴</a>' +
      '<a href="pricing.html">料金プラン</a>' +
      '<a href="ranking.html">ランキング</a>' +
      '<a id="campaignHeaderMobileLogin" href="login.html">ログイン</a>' +
      '<a id="campaignHeaderMobileSignup" href="signup.html">会員登録</a>' +
      '</nav></details>' +
      '</div>' +
      '</div>';
  }

  function configureCountdownShell() {
    const countdown = document.querySelector('.campaign-countdown');
    if (!countdown) return;

    countdown.setAttribute('aria-label', 'LEVEL 10達成期限までの日数');

    const label = countdown.querySelector('small');
    if (label) label.textContent = 'LEVEL 10 DEADLINE';

    const heading = countdown.querySelector('strong');
    if (heading) {
      heading.innerHTML = '達成期限まで あと <b id="daysRemaining">—</b> 日';
    }
  }

  function campaignReturnTarget() {
    return `scout-lv10-campaign.html${window.location.search || ''}`;
  }

  function authHref(page) {
    const url = new URL(page, window.location.href);
    url.searchParams.set('redirect', campaignReturnTarget());
    return `${url.pathname.replace(/^\//, '')}${url.search}`;
  }

  function configureAuthLinks() {
    const linkMap = {
      campaignHeaderLogin: 'login.html',
      campaignHeaderSignup: 'signup.html',
      campaignHeaderMobileLogin: 'login.html',
      campaignHeaderMobileSignup: 'signup.html',
      campaignHeroLogin: 'login.html',
      campaignHeroSignup: 'signup.html',
      campaignBottomLogin: 'login.html',
      campaignBottomSignup: 'signup.html'
    };

    Object.entries(linkMap).forEach(([id, page]) => {
      const node = document.getElementById(id);
      if (node) node.href = authHref(page);
    });
  }

  function setAuthUi(authenticated) {
    document.querySelectorAll('[data-campaign-guest]').forEach((node) => {
      node.hidden = Boolean(authenticated);
    });
    document.querySelectorAll('[data-campaign-member]').forEach((node) => {
      node.hidden = !authenticated;
    });

    const loginLinks = [
      document.getElementById('campaignHeaderLogin'),
      document.getElementById('campaignHeaderMobileLogin')
    ].filter(Boolean);

    loginLinks.forEach((link) => {
      if (authenticated) {
        link.textContent = '創作室';
        link.href = 'mypage.html';
        link.dataset.authState = 'authenticated';
      } else {
        link.textContent = 'ログイン';
        link.href = authHref('login.html');
        link.dataset.authState = 'anonymous';
      }
    });

    document
      .querySelectorAll('header.site-header a[href^="admin"]')
      .forEach((link) => link.remove());
  }

  installCanonicalPublicHeader();
  configureCountdownShell();
  configureAuthLinks();

  if (!window.supabase) return;

  const client = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );

  void NovelightClient.captureAcquisition(client);
  void NovelightClient.recordVisit(client);
  void NovelightClient.claimAcquisition(client);

  const number = new Intl.NumberFormat('ja-JP');
  const dateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const rankNames = ['', 'NOCTIS', 'VESPER', 'UMBRA'];
  const previewNextRankXp = { 1: 1400, 2: 4800 };
  const dayMs = 24 * 60 * 60 * 1000;

  let payload = null;
  let submitting = false;

  const el = (id) => document.getElementById(id);
  const n = (value) => number.format(Number(value ?? 0));

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = value;
  }

  function setState(message, error = false) {
    const node = el('campaignState');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function formatDate(value) {
    if (!value) return '日程確定後に表示';
    return dateTime.format(new Date(value));
  }

  function deadlineDaysRemaining(value) {
    if (!value) return null;
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return null;
    return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / dayMs));
  }

  function maskEmail(value) {
    const email = String(value ?? '');
    const [name, domain] = email.split('@');
    if (!name || !domain) return '登録メールアドレス';
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${'*'.repeat(Math.max(2, Math.min(5, name.length - visible.length)))}@${domain}`;
  }

  function progressPercent(progress) {
    const total = Number(progress.total_xp ?? 0);
    const target = Math.max(1, Number(progress.target_level_xp ?? 1170));
    return Math.max(0, Math.min(100, (total / target) * 100));
  }

  function nextLevelPercent(progress) {
    const total = Number(progress.total_xp ?? 0);
    const floor = Number(progress.level_floor_xp ?? 0);
    const next = Number(progress.next_level_xp ?? total);
    const span = Math.max(1, next - floor);
    return Math.max(0, Math.min(100, ((total - floor) / span) * 100));
  }

  function nextRankProgress(progress) {
    const tier = Math.max(1, Math.min(3, Number(progress.rank_tier ?? 1)));
    if (tier >= 3) {
      return { xp: 0, name: 'β版RANK上限' };
    }
    const nextName = rankNames[tier + 1] ?? 'NEXT RANK';
    const targetXp = Number(
      progress.next_rank_xp ?? previewNextRankXp[tier] ?? progress.total_xp ?? 0
    );
    const remaining = Number(
      progress.xp_for_next_rank ??
        Math.max(0, targetXp - Number(progress.total_xp ?? 0))
    );
    return { xp: remaining, name: `${nextName}まで` };
  }

  function claimStatusLabel(claim) {
    if (!claim) return null;
    const labels = {
      approved_candidate: '申請済み・配布確認中',
      risk_review: '申請済み・確認中',
      approved: '配布確定',
      rejected: '申請結果をご確認ください',
      fulfilled: '配布済み'
    };
    return labels[claim.status] ?? '申請済み';
  }

  function eligibilityButtonLabel(data) {
    const { claim, eligibility } = data;
    if (claim) return claimStatusLabel(claim);
    const labels = {
      preparing: 'キャンペーン準備中',
      paused: '現在受付を一時停止しています',
      ended: 'キャンペーンは終了しました',
      not_started: 'キャンペーン開始前です',
      entry_required: '対象期間中のログインが必要です',
      entry_closed: '参加受付は終了しました',
      level_required: 'LEVEL 10達成で申請できます',
      qualification_deadline_passed: '達成期限を過ぎています',
      claim_deadline_passed: '申請期限を過ぎています',
      eligible: '図書カードを受け取る'
    };
    return labels[eligibility.reason] ?? '申請状況を確認中';
  }

  function renderCampaign(data) {
    payload = data;
    const { campaign, progress, eligibility, claim } = data;

    setText('campaignTitle', campaign.title);
    setText('campaignDescription', campaign.description);
    setText('campaignReward', campaign.rewardLabel);
    setText('campaignStartDate', formatDate(campaign.startsAt));
    setText('campaignEndDate', formatDate(campaign.endsAt));

    const deadlineRemaining = deadlineDaysRemaining(
      eligibility.eligibilityDeadline
    );
    const configuredWindowDays = Number(
      eligibility.isNewUser
        ? campaign.newUserWindowDays
        : campaign.existingUserWindowDays
    );
    const personalDaysRemaining =
      deadlineRemaining ??
      (Number.isFinite(configuredWindowDays) ? configuredWindowDays : null);

    if (personalDaysRemaining === null) {
      setText('daysRemaining', '—');
      setText('countdownNote', 'LEVEL 10達成期限を確認できませんでした。');
    } else {
      setText('daysRemaining', n(personalDaysRemaining));
      setText(
        'countdownNote',
        eligibility.eligibilityDeadline
          ? `LEVEL 10達成期限：${formatDate(eligibility.eligibilityDeadline)}まで（JST）`
          : `LEVEL 10達成期間：対象ログインまたは登録後から${n(configuredWindowDays)}日間`
      );
    }

    const level = Number(progress.level ?? 1);
    const nextRank = nextRankProgress(progress);
    setText('currentLevel', `Lv.${n(level)}`);
    setText('currentRank', progress.rank_name ?? 'NOCTIS');
    setText('nextRankXp', nextRank.name === 'β版RANK上限' ? 'MAX' : `${n(nextRank.xp)} XP`);
    setText('nextRankName', nextRank.name);
    setText('nextLevelXp', `${n(progress.xp_for_next_level)} XP`);
    setText('targetXpRemaining', `${n(progress.xp_to_target)} XP`);
    setText('targetXpCurrent', n(progress.total_xp));
    setText('targetXpGoal', n(progress.target_level_xp));

    const today = Number(progress.today_valid_read_xp ?? 0);
    const todayCap = Number(progress.today_valid_read_xp_cap ?? 10);
    const todayRemaining = Math.max(0, todayCap - today);
    setText('todayXp', `${n(today)} / ${n(todayCap)} XP`);
    setText('todayXpRemaining', `本日の有効読書XPはあと ${n(todayRemaining)} XP`);

    const todayEpisode = Number(progress.today_valid_read_episode_xp ?? 0);
    const todayEpisodeCap = Number(progress.today_valid_read_episode_xp_cap ?? 15);
    const todayEpisodeRemaining = Math.max(0, todayEpisodeCap - todayEpisode);
    setText(
      'todayEpisodeXp',
      `${n(todayEpisode)} / ${n(todayEpisodeCap)} XP`
    );
    setText(
      'todayEpisodeXpRemaining',
      `本日の有効読書（話）XPはあと ${n(todayEpisodeRemaining)} XP`
    );

    const todayComment = Number(progress.today_comment_xp ?? 0);
    const todayCommentCap = Number(progress.today_comment_xp_cap ?? 15);
    const todayCommentRemaining = Math.max(0, todayCommentCap - todayComment);
    setText('todayCommentXp', `${n(todayComment)} / ${n(todayCommentCap)} XP`);
    setText(
      'todayCommentXpRemaining',
      `本日のコメントXPはあと ${n(todayCommentRemaining)} XP`
    );

    const targetPercent = progressPercent(progress);
    const targetTrack = el('targetProgressTrack');
    const targetBar = el('targetProgressBar');
    if (targetTrack) {
      targetTrack.setAttribute('aria-valuenow', String(Math.round(targetPercent)));
    }
    if (targetBar) targetBar.style.width = `${targetPercent}%`;

    const nextPercent = nextLevelPercent(progress);
    const nextTrack = el('nextProgressTrack');
    const nextBar = el('nextProgressBar');
    if (nextTrack) {
      nextTrack.setAttribute('aria-valuenow', String(Math.round(nextPercent)));
    }
    if (nextBar) nextBar.style.width = `${nextPercent}%`;

    const achieved = el('campaignAchieved');
    if (achieved) achieved.hidden = !eligibility.reachedTarget;

    const button = el('claimButton');
    if (button) {
      button.disabled = !eligibility.canClaim || Boolean(claim) || submitting;
      button.textContent = eligibilityButtonLabel(data);
    }

    const status = claimStatusLabel(claim);
    setText(
      'claimStatus',
      status ??
        (eligibility.canClaim
          ? '条件を満たしています。申請すると不正利用確認後に配布対象となります。'
          : eligibility.reason === 'preparing'
            ? '現在はページ確認用の準備状態です。申請受付はまだ有効化していません。'
            : eligibility.reason === 'entry_required'
              ? '10月31日までに対象ログインを行うと、そこから60日間がLEVEL 10達成期間になります。'
              : 'LEVEL 10達成後、条件を満たすと申請ボタンが有効になります。')
    );

    setText(
      'deliveryEmail',
      `${maskEmail(data.deliveryEmail)} 宛にお届けします。`
    );

    setText(
      'eligibilityWindow',
      `既存ユーザー：10月31日までの対象ログインから${n(campaign.existingUserWindowDays)}日以内／新規ユーザー：10月31日までの登録から${n(campaign.newUserWindowDays)}日以内にLEVEL ${n(campaign.targetLevel)}達成。10月6日6:00までの事前ログインは10月6日6:00開始扱いです。`
    );
    setText(
      'claimWindow',
      `LEVEL ${n(campaign.targetLevel)}達成後${n(campaign.claimWindowDays)}日以内に申請`
    );

    document.body.classList.remove('campaign-loading');
    setState(
      campaign.status === 'draft'
        ? 'ページ確認用の準備状態です。申請受付はまだ有効化していません。'
        : '最新のSCOUT RECORDを反映しています。'
    );
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) return null;
    return data.session;
  }

  async function request(method = 'GET', existingSession = null) {
    const session = existingSession ?? (await getSession());
    if (!session) throw new Error('login_required');

    const response = await fetch('/api/scout-lv10-campaign', {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `HTTP_${response.status}`);
    return data;
  }

  function renderGuestState() {
    payload = null;
    setAuthUi(false);
    document.body.classList.remove('campaign-loading');
    setState('キャンペーン内容はログインせず確認できます。参加するには無料会員登録またはログインしてください。');
    setText('currentLevel', '—');
    setText('currentRank', '—');
    setText('nextLevelXp', '—');
    setText('todayXp', '— / 10 XP');
    setText('todayEpisodeXp', '— / 15 XP');
    setText('todayCommentXp', '— / 15 XP');
    setText('todayXpRemaining', 'ログインすると本日の獲得状況を表示します。');
    setText('todayEpisodeXpRemaining', 'ログインすると本日の獲得状況を表示します。');
    setText('todayCommentXpRemaining', 'ログインすると本日の獲得状況を表示します。');
    setText('claimStatus', 'LEVEL 10達成後、ログインした状態で景品を申請できます。');
    setText('deliveryEmail', '登録メールアドレス宛にお届けします。');

    const button = el('claimButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'ログイン後に申請できます';
      button.onclick = null;
    }
  }

  async function load() {
    try {
      setState('SCOUT RECORDを読み込んでいます。');
      const session = await getSession();
      if (!session) {
        renderGuestState();
        return;
      }
      setAuthUi(true);
      const data = await request('GET', session);
      renderCampaign(data);
    } catch (error) {
      document.body.classList.remove('campaign-loading');
      if (error.message === 'login_required') {
        renderGuestState();
        return;
      }
      setState('キャンペーン情報を読み込めませんでした。', true);
    }
  }

  async function submitClaim() {
    if (!payload?.eligibility?.canClaim || submitting) return;
    submitting = true;
    const button = el('claimButton');
    if (button) {
      button.disabled = true;
      button.textContent = '申請を確認しています…';
    }

    try {
      await request('POST');
      await load();
    } catch (error) {
      setState(
        '申請を受け付けられませんでした。条件と申請期限をご確認ください。',
        true
      );
      if (button) {
        button.disabled = false;
        button.textContent = '図書カードを受け取る';
      }
    } finally {
      submitting = false;
    }
  }

  const claimButton = el('claimButton');
  if (claimButton) claimButton.addEventListener('click', submitClaim);

  load();
})();