(() => {
  const mode = document.body.dataset.discoveryMode;
  const pageSize = 24;
  const recommendedPoolSize = 96;
  const candidateBatchSize = 24;
  const list = document.getElementById('discoveryList');
  const count = document.getElementById('discoveryCount');
  const moreWrap = document.getElementById('discoveryMoreWrap');
  const moreButton = document.getElementById('discoveryMore');
  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const seen = new Set();
  const recommendedQueue = [];
  const seedQueue = [];
  let rendered = 0;
  let neutralOffset = 0;
  let neutralTotal = null;
  let recommendedLoaded = false;
  let loading = false;

  function esc(value) {
    const el = document.createElement('div');
    el.textContent = value ?? '';
    return el.innerHTML;
  }

  function visitor() {
    return NovelightClient.getVisitorToken();
  }

  function novelId(novel) {
    return String(novel.novel_id ?? novel.id);
  }

  function missingTrustedRpc(error, name) {
    const text = [error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (
      error?.code === 'PGRST202' ||
      (text.includes(name.toLowerCase()) &&
        (text.includes('schema cache') || text.includes('could not find')))
    );
  }

  function coverMarkup(novel) {
    return `<div class="novel-cover-placeholder" aria-hidden="true"><span class="cover-mark">✦</span><span class="cover-genre">${esc(novel.genre || 'NOVELIGHT')}</span></div>`;
  }

  function card(novel) {
    const created = novel.created_at
      ? new Date(novel.created_at).toLocaleDateString('ja-JP')
      : '';
    const seedBadge =
      mode === 'seed'
        ? `<div class="seed-count">✦ ${Number(novel.light_seed_count || 0).toLocaleString()}</div>`
        : '';
    return `<a class="novel-card shelf-card${mode === 'seed' ? ' seed-card' : ''}" href="novel.html?id=${encodeURIComponent(novelId(novel))}">${seedBadge}${coverMarkup(novel)}<div class="card-copy"><div class="genre">${esc(novel.genre || '未設定')}</div><div class="novel-title">${esc(novel.title)}</div><div class="meta">投稿日 ${created} ・ 👁 ${Number(novel.pv || 0).toLocaleString()} ・ ★ ${Number(novel.favorite_count || 0).toLocaleString()}</div></div></a>`;
  }

  function appendRows(rows) {
    const unique = [];
    for (const row of rows) {
      const id = novelId(row);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(row);
    }
    if (!unique.length) return 0;
    if (rendered === 0) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', unique.map(card).join(''));
    rendered += unique.length;
    updateCount();
    return unique.length;
  }

  function updateCount() {
    if (mode === 'new' && neutralTotal !== null) {
      count.textContent = `${rendered.toLocaleString()} / ${neutralTotal.toLocaleString()}作品を表示`;
      return;
    }
    const label = mode === 'recommended' ? 'おすすめ' : 'LIGHT SEEDで発掘中';
    count.textContent = `${label} ${rendered.toLocaleString()}作品を表示`;
  }

  function setError(message) {
    if (rendered === 0) list.innerHTML = `<div class="state">${esc(message)}</div>`;
  }

  async function recordTrusted(rows) {
    const receipts = rows.map((row) => row.allocation_receipt).filter(Boolean);
    if (!receipts.length) return;
    const result = await client.rpc('record_trusted_allocation_receipts', {
      p_receipts: receipts
    });
    if (result.error) console.error('recommended impression record failed', result.error);
  }

  async function recordNeutral(rows) {
    if (!rows.length) return;
    const result = await client.rpc('record_neutral_search_impressions', {
      p_novel_ids: rows.map(novelId),
      p_visitor_token: visitor()
    });
    if (result.error) console.error('neutral impression record failed', result.error);
  }

  async function fetchRecommended(limit = recommendedPoolSize) {
    const args = {
      p_surface: 'search_recommended',
      p_limit: limit,
      p_keyword: null,
      p_genre: null,
      p_visitor_token: visitor()
    };
    let result = await client.rpc('novelight_trusted_discovery_feed', args);
    if (result.error && missingTrustedRpc(result.error, 'novelight_trusted_discovery_feed')) {
      result = await client.rpc('novelight_discovery_feed_v2', args);
    }
    if (result.error) throw result.error;
    return (result.data || []).filter((row) => !row.is_premium_slot);
  }

  async function fillRecommendedQueue() {
    if (recommendedLoaded) return;
    const rows = await fetchRecommended();
    for (const row of rows) {
      const id = novelId(row);
      if (!seen.has(id) && !recommendedQueue.some((queued) => novelId(queued) === id)) {
        recommendedQueue.push(row);
      }
    }
    recommendedLoaded = true;
  }

  async function loadRecommended() {
    await fillRecommendedQueue();
    const page = recommendedQueue.splice(0, pageSize);
    appendRows(page);
    await recordTrusted(page);
    moreWrap.hidden = recommendedQueue.length === 0;
    moreButton.textContent = 'おすすめをもっと見る';
  }

  async function fetchNeutralNew(limit = pageSize) {
    const result = await client.rpc('novelight_neutral_search', {
      p_keyword: null,
      p_genre: null,
      p_sort: 'new',
      p_limit: limit,
      p_offset: neutralOffset
    });
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (neutralTotal === null) neutralTotal = Number(rows[0]?.total_count ?? rows.length);
    neutralOffset += rows.length;
    return rows;
  }

  async function loadNew() {
    const rows = await fetchNeutralNew(pageSize);
    appendRows(rows);
    await recordNeutral(rows);
    moreWrap.hidden = rows.length < pageSize || neutralOffset >= Number(neutralTotal || 0);
    moreButton.textContent = 'さらに24作品を見る';
  }

  async function seedStatus(row) {
    try {
      const result = await client.rpc('light_seed_status', {
        p_novel_id: novelId(row)
      });
      if (result.error) return null;
      const seedCount = Number(result.data?.total_seed_count || 0);
      if (seedCount <= 0) return null;
      return Object.assign({}, row, {
        light_seed_count: seedCount
      });
    } catch (error) {
      console.error('LIGHT SEED status failed', error);
      return null;
    }
  }

  async function fillSeedQueue() {
    while (seedQueue.length < pageSize && neutralOffset < Number(neutralTotal ?? Infinity)) {
      const rows = await fetchNeutralNew(candidateBatchSize);
      if (!rows.length) break;
      const checked = await Promise.all(rows.map(seedStatus));
      for (const row of checked.filter(Boolean)) {
        const id = novelId(row);
        if (!seen.has(id) && !seedQueue.some((queued) => novelId(queued) === id)) {
          seedQueue.push(row);
        }
      }
      if (rows.length < candidateBatchSize || neutralOffset >= Number(neutralTotal || 0)) break;
    }
  }

  async function loadSeed() {
    await fillSeedQueue();
    const page = seedQueue.splice(0, pageSize);
    appendRows(page);
    await recordNeutral(page);
    const exhausted = neutralOffset >= Number(neutralTotal || 0) && seedQueue.length === 0;
    moreWrap.hidden = exhausted || page.length === 0;
    moreButton.textContent = '発掘中の作品をもっと見る';
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    moreButton.disabled = true;
    const oldLabel = moreButton.textContent;
    moreButton.textContent = '読み込み中...';
    try {
      if (mode === 'recommended') await loadRecommended();
      else if (mode === 'new') await loadNew();
      else if (mode === 'seed') await loadSeed();
    } catch (error) {
      console.error(error);
      setError('作品を読み込めませんでした。時間をおいて再度お試しください。');
      moreButton.textContent = oldLabel;
    } finally {
      loading = false;
      moreButton.disabled = false;
    }
  }

  moreButton.addEventListener('click', loadMore);

  (async () => {
    await NovelightClient.captureAcquisition(client);
    await NovelightClient.recordVisit(client);
    void NovelightClient.claimAcquisition(client);
    try {
      await loadMore();
      if (rendered === 0) {
        const empty =
          mode === 'seed'
            ? '現在表示できるLIGHT SEEDで発掘中の作品はありません。'
            : '現在表示できる作品はありません。';
        list.innerHTML = `<div class="state">${empty}</div>`;
        count.textContent = '0作品';
      }
    } catch (error) {
      console.error(error);
      setError('作品を読み込めませんでした。時間をおいて再度お試しください。');
      count.textContent = '読み込みエラー';
    }
  })();
})();