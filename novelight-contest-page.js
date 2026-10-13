// NOVELIGHT November contest landing page.
// Guest readers can browse contest entries; only authors can submit enrollment.
(function () {
  'use strict';

  const PAGE_SIZE = 24;
  const endpoint = 'novelight_public_contest_catalog_filtered';
  const R15_PREF_KEY = 'novelight:hide-r15-discovery';
  const databaseUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
  const publishableKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

  const client = supabase.createClient(databaseUrl, publishableKey);
  const statusEl = document.getElementById('contestStatus');
  const entriesEl = document.getElementById('contestEntries');
  const countEl = document.getElementById('entryCount');
  const more = document.getElementById('contestMoreButton');
  const loginPrompt = document.getElementById('contestLoginPrompt');
  const enrollmentEl = document.getElementById('contestEnrollment');
  const noteEl = document.getElementById('entryPhaseNote');
  const hideR15Control = document.getElementById('contestHideR15');
  const rankSection = document.getElementById('contestRankingSection');
  const rankList = document.getElementById('contestRankingList');
  const rankDate = document.getElementById('contestRankingDate');

  let offset = 0;
  let loading = false;
  let requestRevision = 0;
  let rankRevision = 0;
  let currentStatus = 'draft';

  function storedHideR15() {
    try {
      return window.localStorage.getItem(R15_PREF_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setHideR15(value) {
    try {
      window.localStorage.setItem(R15_PREF_KEY, value ? '1' : '0');
      return true;
    } catch {
      return false;
    }
  }

  if (hideR15Control) hideR15Control.checked = storedHideR15();

  const stateText = {
    draft: '開催準備中',
    registration: '作品エントリー受付中',
    active: 'コンテスト開催中',
    review: '集計・審査中',
    finalized: '結果確定',
    cancelled: '中止'
  };

  async function loadPublishedRanking() {
    if (!rankSection || !rankList) return;
    const revision = ++rankRevision;
    rankSection.hidden = true;
    rankList.replaceChildren();
    if (!['active', 'review'].includes(currentStatus)) return;
    try {
      const { data, error } = await client.rpc('novelight_public_contest_rankings', {
        p_include_r15: !storedHideR15()
      });
      if (revision !== rankRevision || error || data?.ok !== true ||
          !Array.isArray(data.rows)) return;
      rankDate.textContent =
        '発表基準：' + new Date(data.scheduled_publish_at).toLocaleString(
          'ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit' }
        ) + '（日本時間）';
      for (const work of data.rows) {
        const li = document.createElement('li');
        li.className = 'contest-ranking-item';
        const place = document.createElement('strong');
        place.textContent = String(work.rank) + '位';
        const link = document.createElement('a');
        link.href = 'novel.html?id=' + encodeURIComponent(work.novel_id);
        link.textContent = String(work.title || '無題の作品');
        const points = document.createElement('span');
        points.className = 'contest-ranking-points';
        points.textContent = String(work.points) + 'pt';
        li.append(place, link, points);
        rankList.append(li);
      }
      if (!data.rows.length) {
        const li = document.createElement('li');
        li.textContent = '現在表示できる参加作品はありません。';
        rankList.append(li);
      }
      rankSection.hidden = false;
    } catch {
      // Missing or unpublished snapshot must not leak any rank data.
      rankSection.hidden = true;
    }
  }

  function entryCard(work) {
    const article = document.createElement('article');
    article.className = 'contest-entry-card';

    const tags = document.createElement('div');
    tags.className = 'contest-entry-card-tags';

    for (const label of [
      String(work.genre || 'ジャンル未設定'),
      '公開' + String(work.published_episodes) + '話'
    ]) {
      const chip = document.createElement('span');
      chip.textContent = label;
      tags.append(chip);
    }

    if (work.content_rating === 'sensitive_15' ||
        work.content_rating === 'adult_18_nonsexual' ||
        work.content_rating === 'mature') {
      const warning = document.createElement('span');
      warning.textContent = '内容注意';
      tags.append(warning);
    }

    const title = document.createElement('h3');
    title.textContent = String(work.title || '無題の作品');

    const link = document.createElement('a');
    link.className = 'contest-entry-card-action';
    link.href = 'novel.html?id=' + encodeURIComponent(work.novel_id);
    link.textContent = '作品を読む →';
    link.setAttribute('aria-label', title.textContent + 'を読む');

    article.append(tags, title, link);
    return article;
  }

  async function loadEntries(reset) {
    if (loading && !reset) return;
    const myRevision = ++requestRevision;
    loading = true;
    more.disabled = true;
    if (reset) {
      offset = 0;
      entriesEl.replaceChildren();
    }

    try {
      const { data, error } = await client.rpc(endpoint, {
        p_limit: PAGE_SIZE,
        p_offset: offset,
        p_include_r15: !storedHideR15()
      });
      if (myRevision !== requestRevision) return;
      if (error) throw error;
      if (!data?.ok || !Array.isArray(data.entries)) {
        throw new Error('contest_catalog_unavailable');
      }

      currentStatus = data.contest_status;
      statusEl.textContent = stateText[currentStatus] || '開催情報を確認中';
      void loadPublishedRanking();
      const total = Math.max(0, Number(data.total_entries) || 0);
      const works = data.entries;

      countEl.textContent = total > 0 ? total.toLocaleString('ja-JP') + '作品が参加中' : '';

      if (!works.length && offset === 0) {
        const empty = document.createElement('p');
        empty.className = 'contest-list-message';
        empty.textContent =
          currentStatus === 'draft'
            ? 'エントリー受付開始後、参加作品を掲載します。'
            : '参加作品はまだありません。';
        entriesEl.append(empty);
      } else {
        for (const work of works) entriesEl.append(entryCard(work));
      }

      offset += works.length;
      more.hidden = offset >= total || works.length === 0;
    } catch (error) {
      if (myRevision !== requestRevision) return;
      console.warn('Contest catalog unavailable', error?.code || '');
      if (reset) entriesEl.replaceChildren();
      ++rankRevision;
      if (rankSection) rankSection.hidden = true;
      if (!entriesEl.children.length) {
        const message = document.createElement('p');
        message.className = 'contest-list-message';
        message.textContent =
          '参加作品の読み込みに失敗しました。時間をおいて再読み込みしてください。';
        entriesEl.append(message);
      }
      more.textContent = '再読み込みする';
      more.hidden = false;
    } finally {
      if (myRevision === requestRevision) {
        loading = false;
        more.disabled = false;
      }
    }
  }

  async function loadAuthorEnrollment() {
    if (!window.NovelightContestEntry?.mountContestPage) {
      noteEl.textContent = 'エントリー受付の準備中です。';
      return;
    }
    let session;
    try {
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      session = result.data.session;
    } catch {
      noteEl.textContent = 'ログイン状態を確認できませんでした。';
      return;
    }

    if (!session) {
      noteEl.textContent = '作者アカウントでログインすると応募できます。';
      loginPrompt.hidden = false;
      return;
    }

    noteEl.textContent = 'ご自身の作品から応募できます。';
    await window.NovelightContestEntry.mountContestPage({
      client,
      root: enrollmentEl,
      session
    });
  }

  if (hideR15Control) {
    hideR15Control.addEventListener('change', () => {
      if (!setHideR15(hideR15Control.checked)) {
        hideR15Control.checked = storedHideR15();
      }
      void loadEntries(true);
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== R15_PREF_KEY) return;
      hideR15Control.checked = storedHideR15();
      void loadEntries(true);
    });
  }

  more.addEventListener('click', async () => {
    more.textContent = 'もっと作品を見る';
    await loadEntries(false);
  });

  void NovelightClient.recordVisit(client);
  void loadEntries(true);
  void loadAuthorEnrollment();
})();
