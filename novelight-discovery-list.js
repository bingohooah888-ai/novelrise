(() => {
  const mode = document.body.dataset.discoveryMode;
  const pageSize = 24;
  const recommendedPoolSize = 96;
  const list = document.getElementById('discoveryList');
  const count = document.getElementById('discoveryCount');
  const moreWrap = document.getElementById('discoveryMoreWrap');
  const moreButton = document.getElementById('discoveryMore');
  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const seen = new Set();
  let rendered = 0;
  let neutralOffset = 0;
  let neutralTotal = null;
  let seedOffset = 0;
  let loading = false;
  let sessionPromise = null;

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

  function shouldFallbackFeed(result, name) {
    if (!result?.error) return !Array.isArray(result?.data);
    return missingTrustedRpc(result.error, name);
  }

  async function currentSession() {
    if (!sessionPromise) {
      sessionPromise = client.auth
        .getSession()
        .then((result) => result.data?.session || null)
        .catch((error) => {
          console.error('discovery session lookup failed', error);
          return null;
        });
    }
    return sessionPromise;
  }

  async function filterHiddenRows(rows) {
    if (!rows.length) return rows;
    const session = await currentSession();
    if (!session) return rows;

    const result = await client.rpc('novelight_hidden_novel_ids', {
      p_novel_ids: rows.map(novelId),
    });
    if (result.error) {
      console.error('discovery mute filter failed', result.error);
      return rows;
    }

    const hidden = new Set(
      (Array.isArray(result.data) ? result.data : []).map(String)
    );
    return rows.filter((row) => !hidden.has(novelId(row)));
  }

  function coverMarkup(novel) {
    const url = String(novel.thumbnail_url || '').trim();
    if (url) {
      return `<img class="novel-cover-image" src="${esc(url)}" alt="" loading="lazy" decoding="async">`;
    }
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
    if (!unique.length) return [];
    if (rendered === 0) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', unique.map(card).join(''));
    rendered += unique.length;
    updateCount();
    return unique;
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

  async function consumeReceipts(receipts, label) {
    if (!receipts.length) return;
    let result = await client.rpc('record_trusted_allocation_receipts_v2', {
      p_receipts: receipts,
      p_visitor_token: visitor(),
    });
    if (
      result.error &&
      missingTrustedRpc(result.error, 'record_trusted_allocation_receipts_v2')
    ) {
      result = await client.rpc('record_trusted_allocation_receipts', {
        p_receipts: receipts,
      });
    }
    if (result.error) console.error(`${label} impression record failed`, result.error);
  }

  async function recordTrusted(rows) {
    await consumeReceipts(
      rows.map((row) => row.allocation_receipt).filter(Boolean),
      'recommended'
    );
  }

  async function recordNeutralFallback(rows) {
    if (!rows.length) return;
    const result = await client.rpc('record_neutral_search_impressions', {
      p_novel_ids: rows.map(novelId),
      p_visitor_token: visitor(),
    });
    if (result.error) console.error('neutral telemetry fallback failed', result.error);
  }

  async function recordVisible(surface, rows, offset = 0) {
    if (!rows.length) return;
    const issued = await client.rpc('novelight_issue_visible_allocation_receipts_v2', {
      p_surface: surface,
      p_novel_ids: rows.map(novelId),
      p_visitor_token: visitor(),
      p_offset: offset,
      p_rotation_key: null,
    });
    if (
      shouldFallbackFeed(
        issued,
        'novelight_issue_visible_allocation_receipts_v2'
      )
    ) {
      await recordNeutralFallback(rows);
      return;
    }
    if (issued.error) {
      console.error(`${surface} receipt issue failed`, issued.error);
      return;
    }
    await consumeReceipts(
      issued.data.map((row) => row.allocation_receipt).filter(Boolean),
      surface
    );
  }

  async function fetchRecommended(limit = recommendedPoolSize) {
    const args = {
      p_surface: 'search_recommended',
      p_limit: limit,
      p_keyword: null,
      p_genre: null,
      p_visitor_token: visitor(),
    };
    let result = await client.rpc('novelight_trusted_discovery_feed_v2', args);
    if (shouldFallbackFeed(result, 'novelight_trusted_discovery_feed_v2')) {
      result = await client.rpc('novelight_trusted_discovery_feed', args);
    }
    if (shouldFallbackFeed(result, 'novelight_trusted_discovery_feed')) {
      result = await client.rpc('novelight_discovery_feed_v2', args);
    }
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Invalid discovery feed response');
    return result.data.filter((row) => !row.is_premium_slot);
  }

  async function loadRecommended() {
    const rows = await fetchRecommended();
    const batchSeen = new Set();
    const candidates = [];
    for (const row of rows) {
      const id = novelId(row);
      if (seen.has(id) || batchSeen.has(id)) continue;
      batchSeen.add(id);
      candidates.push(row);
    }
    const filtered = await filterHiddenRows(candidates);
    const page = filtered.slice(0, pageSize);
    const visible = appendRows(page);
    await recordTrusted(visible);
    moreWrap.hidden = candidates.length <= pageSize || page.length === 0;
    moreButton.textContent = 'おすすめをもっと見る';
  }

  async function fetchNeutralNew(limit = pageSize) {
    const result = await client.rpc('novelight_neutral_search', {
      p_keyword: null,
      p_genre: null,
      p_sort: 'new',
      p_limit: limit,
      p_offset: neutralOffset,
    });
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (neutralTotal === null) neutralTotal = Number(rows[0]?.total_count ?? rows.length);
    neutralOffset += rows.length;
    return rows;
  }

  async function loadNew() {
    const pageOffset = neutralOffset;
    const rows = await fetchNeutralNew(pageSize);
    const filtered = await filterHiddenRows(rows);
    const visible = appendRows(filtered);
    await recordVisible('search_new', visible, pageOffset);
    moreWrap.hidden = rows.length < pageSize || neutralOffset >= Number(neutralTotal || 0);
    moreButton.textContent = 'さらに24作品を見る';
  }

  async function fetchSeedPage() {
    const result = await client.rpc('novelight_light_seed_feed', {
      p_limit: pageSize + 1,
      p_offset: seedOffset,
    });
    if (result.error) throw result.error;
    const rows = (Array.isArray(result.data) ? result.data : []).filter(
      (row) => row.status === 'published' && Number(row.light_seed_count || 0) > 0
    );
    return rows;
  }

  async function loadSeed() {
    const pageOffset = seedOffset;
    const rows = await fetchSeedPage();
    const rawPage = rows.slice(0, pageSize);
    const page = await filterHiddenRows(rawPage);
    const visible = appendRows(page);
    await recordVisible('search_seed', visible, pageOffset);
    seedOffset += rawPage.length;
    moreWrap.hidden = rows.length <= pageSize || rawPage.length === 0;
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
