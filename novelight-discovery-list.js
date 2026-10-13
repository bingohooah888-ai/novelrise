(() => {
  const mode = document.body.dataset.discoveryMode;
  const pageSize = 24;
  const recommendedPoolSize = 96;
  const coverWidth = 384;
  const coverQuality = 75;
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

  function optimizedImageUrl(url, width = coverWidth, quality = coverQuality) {
    const source = String(url || '').trim();
    if (!source || source.startsWith('/_vercel/image?')) return source;

    try {
      const parsed = new URL(source, window.location.origin);
      const sameOrigin = parsed.origin === window.location.origin;
      const supabaseStorage =
        parsed.hostname === 'fiepaguycecrredwrcwx.supabase.co' &&
        parsed.pathname.startsWith('/storage/v1/object/');
      if (!sameOrigin && !supabaseStorage) return source;

      const optimizerSource = sameOrigin
        ? `${parsed.pathname}${parsed.search}`
        : parsed.href;
      return `/_vercel/image?url=${encodeURIComponent(optimizerSource)}&w=${width}&q=${quality}`;
    } catch {
      return source;
    }
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
    rows = typeof NovelightR15 === 'undefined' ? rows : await NovelightR15.filterRows(rows, client);
    if (!rows.length) return rows;
    const session = await currentSession();
    if (!session) return rows;

    const result = await client.rpc('novelight_hidden_novel_ids', {
      p_novel_ids: rows.map(novelId)
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
      const optimized = optimizedImageUrl(url);
      return `<img class="novel-cover-image" src="${esc(optimized)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
    }
    return `<div class="novel-cover-placeholder" aria-hidden="true"><span class="cover-mark">✦</span><span class="cover-genre">${esc(novel.genre || 'NOVELIGHT')}</span></div>`;
  }

  // All three discovery lists share one bounded, public metadata lookup.
  // This is display-only and never changes trusted allocation or list ordering.
  const cardStateCache = new Map();

  async function hydrateCardState(rows) {
    const ids = [...new Set(rows.map(novelId))]
      .filter((id) => /^[0-9]+$/u.test(id) && !cardStateCache.has(id));
    if (ids.length) {
      let result = await client.rpc('novelight_public_discovery_card_state', {
        p_novel_ids: ids
      });
      if (result.error) {
        console.error('discovery card state lookup failed', result.error);
        // Preserve author/status/count while a pending DB release propagates.
        result = await client.rpc('novelight_search_card_metadata', {
          p_novel_ids: ids
        });
      }
      if (!result.error && Array.isArray(result.data)) {
        const byId = new Map(
          result.data.map((item) => [String(item.novel_id), item])
        );
        for (const id of ids) cardStateCache.set(id, byId.get(id) || null);
      } else {
        console.error('discovery card metadata unavailable', result.error);
      }
    }
    for (const row of rows) {
      const state = cardStateCache.get(novelId(row));
      if (!state) continue;
      row.card_state_loaded = true;
      row.card_is_completed = state.is_completed === true;
      row.card_published_episode_count = state.published_episode_count;
      row.card_latest_published_at = state.latest_published_at || null;
      row.author_name = state.author_name || row.author_name || '';
    }
  }

  function card(novel) {
    const seedBadge =
      mode === 'seed' ? '<div class="seed-count">✦ LIGHT SEED</div>' : '';
    const name = novel.author_name || '作者情報を取得できません';
    const known = novel.card_state_loaded === true;
    const count = Number(novel.card_published_episode_count);
    const countLabel =
      known && Number.isSafeInteger(count) && count >= 0
        ? `公開${count.toLocaleString('ja-JP')}話`
        : '公開話数を確認できません';
    const statusLabel = known
      ? novel.card_is_completed
        ? '完結済み'
        : '連載中'
      : '連載状況を確認できません';
    const latest = novel.card_latest_published_at
      ? new Date(novel.card_latest_published_at)
      : null;
    const publishedLabel =
      latest && !Number.isNaN(latest.getTime())
        ? latest.toLocaleDateString('ja-JP')
        : known && count === 0
          ? '掲載話なし'
          : '確認できません';
    return `<a class="novel-card shelf-card${mode === 'seed' ? ' seed-card' : ''}" href="novel.html?id=${encodeURIComponent(novelId(novel))}">${seedBadge}${coverMarkup(novel)}<div class="card-copy"><div class="badges discovery-card-labels"><div class="genre">${esc(novel.genre || '未設定')}</div></div><div class="novel-title">${esc(novel.title)}</div><div class="discovery-card-meta"><div class="discovery-card-author">作者：${esc(name)}</div><div class="discovery-card-progress">${esc(statusLabel)} ・ ${esc(countLabel)}</div><div class="discovery-card-updated">最終投稿日：${esc(publishedLabel)}</div></div></div></a>`;
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
      p_visitor_token: visitor()
    });
    if (
      result.error &&
      missingTrustedRpc(result.error, 'record_trusted_allocation_receipts_v2')
    ) {
      result = await client.rpc('record_trusted_allocation_receipts', {
        p_receipts: receipts
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
      p_visitor_token: visitor()
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
      p_rotation_key: null
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
      p_visitor_token: visitor()
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
    const filteredCandidates = await filterHiddenRows(candidates);
    candidates.splice(0, candidates.length, ...filteredCandidates);
    const page = candidates.slice(0, pageSize);
    await hydrateCardState(page);
    const visible = appendRows(page);
    await recordTrusted(visible);
    moreWrap.hidden = candidates.length <= pageSize || page.length === 0;
    moreButton.textContent = 'おすすめをもっと見る';
  }

  async function fetchNeutralNew(limit = pageSize) {
    let result = await client.rpc('novelight_recent_updates_feed', {
      p_limit: limit,
      p_offset: neutralOffset
    });
    if (shouldFallbackFeed(result, 'novelight_recent_updates_feed')) {
      result = await client.rpc('novelight_neutral_search', {
        p_keyword: null,
        p_genre: null,
        p_sort: 'new',
        p_limit: limit,
        p_offset: neutralOffset
      });
    }
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
    await hydrateCardState(filtered);
    const visible = appendRows(filtered);
    await recordVisible('search_new', visible, pageOffset);
    moreWrap.hidden = rows.length < pageSize || neutralOffset >= Number(neutralTotal || 0);
    moreButton.textContent = 'さらに24作品を見る';
  }

  async function fetchSeedPage() {
    const result = await client.rpc('novelight_light_seed_feed', {
      p_limit: pageSize + 1,
      p_offset: seedOffset
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
    const page = rows.slice(0, pageSize);
    const rawPageLength = page.length;
    seedOffset += page.length;
    const filteredPage = await filterHiddenRows(page);
    page.splice(0, page.length, ...filteredPage);
    await hydrateCardState(page);
    const visible = appendRows(page);
    await recordVisible('search_seed', visible, pageOffset);
    moreWrap.hidden = rows.length <= pageSize || rawPageLength === 0;
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
