(function () {
  'use strict';

  const STORAGE_PREFIX = 'novelight:reading:v1:';
  const STYLE_ID = 'novelight-reading-continuity-style';
  const REMOTE_TABLE = 'reader_reading_progress';
  const REMOTE_SAVE_DELAY_MS = 2500;
  const remoteSaveTimers = new Map();

  function pageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function progressKey(novelId) {
    return STORAGE_PREFIX + String(novelId || '');
  }

  function readProgress(novelId) {
    try {
      const value = JSON.parse(window.localStorage.getItem(progressKey(novelId)) || 'null');
      if (!value || String(value.novelId) !== String(novelId) || !value.episodeId) return null;
      return value;
    } catch {
      return null;
    }
  }

  function writeProgress(value) {
    if (!value?.novelId || !value?.episodeId) return false;
    try {
      window.localStorage.setItem(progressKey(value.novelId), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function timestamp(value) {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function laterReadAt(left, right) {
    const latest = Math.max(timestamp(left), timestamp(right));
    return new Date(latest > 0 ? latest : Date.now()).toISOString();
  }

  function mergeProgress(current, incoming) {
    if (!current) return incoming || null;
    if (!incoming) return current;

    const currentNumber = Number(current.episodeNumber) || 0;
    const incomingNumber = Number(incoming.episodeNumber) || 0;
    const lastReadAt = laterReadAt(current.lastReadAt, incoming.lastReadAt);

    if (incomingNumber > currentNumber) return { ...incoming, lastReadAt };
    if (incomingNumber < currentNumber) return { ...current, lastReadAt };

    if (String(incoming.episodeId) !== String(current.episodeId)) {
      const winner = timestamp(incoming.lastReadAt) >= timestamp(current.lastReadAt) ? incoming : current;
      return { ...winner, lastReadAt };
    }

    return {
      ...current,
      ...incoming,
      progressRatio: Math.max(clamp(current.progressRatio), clamp(incoming.progressRatio)),
      lastReadAt,
      syncUserId: incoming.syncUserId || current.syncUserId || null
    };
  }

  function contentProgress(content) {
    if (!content) return 0;
    const rect = content.getBoundingClientRect();
    const absoluteTop = window.scrollY + rect.top;
    const height = Math.max(content.scrollHeight, rect.height, 1);
    const viewportBottom = window.scrollY + window.innerHeight;
    return clamp((viewportBottom - absoluteTop) / height);
  }

  async function authenticatedUserId(clientInstance) {
    if (!clientInstance?.auth?.getSession) return null;
    try {
      const result = await clientInstance.auth.getSession();
      if (result.error) return null;
      return result.data?.session?.user?.id || null;
    } catch {
      return null;
    }
  }

  function remoteProgress(row, userId) {
    if (!row?.novel_id || !row?.episode_id) return null;
    return {
      novelId: String(row.novel_id),
      episodeId: String(row.episode_id),
      episodeNumber: Number(row.episode_number) || 0,
      progressRatio: clamp(row.progress_ratio),
      lastReadAt: row.last_read_at || new Date().toISOString(),
      syncUserId: userId || row.user_id || null
    };
  }

  async function hydrateRemoteProgress(clientInstance, novelIds) {
    const userId = await authenticatedUserId(clientInstance);
    const ids = Array.from(new Set((novelIds || []).map((value) => String(value || '')).filter(Boolean)));
    if (!userId || !ids.length) return { authenticated: Boolean(userId), userId, synced: false };

    try {
      const result = await clientInstance
        .from(REMOTE_TABLE)
        .select('user_id,novel_id,episode_id,episode_number,progress_ratio,last_read_at')
        .eq('user_id', userId)
        .in('novel_id', ids);
      if (result.error) throw result.error;

      for (const row of result.data || []) {
        const remote = remoteProgress(row, userId);
        if (!remote) continue;
        const local = readProgress(remote.novelId);
        const merged = local?.syncUserId === userId ? mergeProgress(remote, local) : remote;
        writeProgress({ ...merged, syncUserId: userId });
      }
      return { authenticated: true, userId, synced: true };
    } catch (error) {
      console.warn('reading progress hydration failed; using this device', error);
      return { authenticated: true, userId, synced: false };
    }
  }

  async function pushLocalProgress(clientInstance, userId, novelId) {
    if (!clientInstance || !userId || !novelId) return false;
    const stored = readProgress(novelId);
    if (!stored || stored.syncUserId !== userId) return false;

    try {
      const result = await clientInstance
        .from(REMOTE_TABLE)
        .upsert({
          user_id: userId,
          novel_id: String(stored.novelId),
          episode_id: String(stored.episodeId),
          progress_ratio: clamp(stored.progressRatio),
          last_read_at: stored.lastReadAt || new Date().toISOString()
        }, { onConflict: 'user_id,novel_id' })
        .select('user_id,novel_id,episode_id,episode_number,progress_ratio,last_read_at')
        .single();
      if (result.error) throw result.error;
      const canonical = remoteProgress(result.data, userId);
      if (canonical) {
        const latestLocal = readProgress(novelId);
        writeProgress({ ...mergeProgress(canonical, latestLocal?.syncUserId === userId ? latestLocal : null), syncUserId: userId });
      }
      return true;
    } catch (error) {
      console.warn('reading progress sync failed; kept on this device', error);
      return false;
    }
  }

  function scheduleRemoteProgress(clientInstance, userId, novelId) {
    if (!clientInstance || !userId || !novelId || remoteSaveTimers.has(String(novelId))) return;
    const key = String(novelId);
    const timer = window.setTimeout(() => {
      remoteSaveTimers.delete(key);
      void pushLocalProgress(clientInstance, userId, key);
    }, REMOTE_SAVE_DELAY_MS);
    remoteSaveTimers.set(key, timer);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-reading-nav{margin:18px 0 0;padding:18px;border:1px solid rgba(201,169,106,.34);border-radius:14px;background:rgba(255,252,244,.92);box-shadow:0 12px 32px rgba(43,31,20,.06)}
      .nl-reading-nav-main{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:stretch;gap:10px}
      .nl-reading-link{display:flex;align-items:center;justify-content:center;min-height:48px;padding:11px 14px;border:1px solid rgba(90,70,42,.18);border-radius:10px;background:#fff;color:#382b1e;font-weight:800;text-align:center;text-decoration:none!important}
      .nl-reading-link:hover{border-color:#b8924f;transform:translateY(-1px)}
      .nl-reading-link.next{background:#3b2a1d;color:#fff;border-color:#3b2a1d}
      .nl-reading-link.disabled{color:#9b9186;background:#f5f1e9;pointer-events:none}
      .nl-reading-finished{margin-top:10px;color:#776a5c;font-size:12px;text-align:center}
      .nl-resume-chip{display:inline-flex;align-items:center;gap:6px;margin:-18px 0 24px;padding:8px 12px;border:1px solid rgba(184,146,79,.35);border-radius:999px;background:#fffaf0;color:#6f4d1e;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
      .nl-continue-panel{margin:0 0 18px;padding:15px 16px;border:1px solid rgba(201,169,106,.3);border-radius:12px;background:linear-gradient(135deg,#fffdf7,#faf4e6)}
      .nl-continue-label{display:block;margin-bottom:7px;color:#7b6c58;font-size:11px;font-weight:800;letter-spacing:.08em}
      .nl-continue-link{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#39291c!important;font-weight:900;text-decoration:none!important}
      .nl-continue-link strong{font-size:15px}.nl-continue-arrow{font-size:18px;color:#9b6e2c}
      .nl-bookshelf-item{display:grid;gap:8px}.nl-bookshelf-item>.card{margin:0}
      .nl-bookshelf-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #e5e0d7;border-radius:10px;background:#fffdf8;flex-wrap:wrap}
      .nl-bookshelf-state{font-size:12px;font-weight:800;color:#765e3b}.nl-bookshelf-state.updated{color:#9a5b16}
      .nl-bookshelf-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .nl-bookshelf-action{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:7px 11px;border-radius:8px;border:1px solid #d8ccb9;background:#fff;color:#4b3928!important;font-size:12px;font-weight:900;text-decoration:none!important}
      .nl-bookshelf-action.primary{background:#3b2a1d;color:#fff!important;border-color:#3b2a1d}
      @media(max-width:640px){.nl-reading-nav-main{grid-template-columns:1fr 1fr}.nl-reading-link.next{grid-column:1/-1;grid-row:1}.nl-reading-link.toc{grid-column:1/-1}.nl-bookshelf-meta{align-items:flex-start}.nl-bookshelf-actions{width:100%}.nl-bookshelf-action{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function waitFor(selector, { timeout = 10000, root = document } = {}) {
    const found = root.querySelector(selector);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const node = root.querySelector(selector);
        if (!node) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(node);
      });
      observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for ${selector}`));
      }, timeout);
    });
  }

  function episodeHref(id) {
    return `episode.html?id=${encodeURIComponent(id)}`;
  }

  function novelHref(id) {
    return `novel.html?id=${encodeURIComponent(id)}`;
  }

  function parseNovelId(href) {
    try {
      return new URL(href, window.location.href).searchParams.get('id');
    } catch {
      return null;
    }
  }

  async function publishedEpisodes(clientInstance, novelId) {
    const result = await clientInstance
      .from('episodes')
      .select('id,novel_id,title,episode_number,status')
      .eq('novel_id', novelId)
      .eq('status', 'published')
      .order('episode_number', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  function installResumeChip(content, stored, row) {
    if (!stored || String(stored.episodeId) !== String(row.id)) return;
    const ratio = clamp(stored.progressRatio);
    if (ratio < 0.08 || ratio >= 0.9) return;
    const heading = content.closest('#card')?.querySelector('h1');
    if (!heading || document.getElementById('nlResumeChip')) return;
    const button = document.createElement('button');
    button.id = 'nlResumeChip';
    button.className = 'nl-resume-chip';
    button.type = 'button';
    button.textContent = `↪ 前回の続きへ（約${Math.round(ratio * 100)}%）`;
    button.addEventListener('click', () => {
      const top = window.scrollY + content.getBoundingClientRect().top;
      const target = top + Math.max(0, content.scrollHeight * ratio - window.innerHeight * 0.35);
      window.scrollTo({ top: target, behavior: 'smooth' });
    });
    heading.insertAdjacentElement('afterend', button);
  }

  function saveEpisodeProgress(row, content, clientInstance = null, userId = null) {
    let previous = readProgress(row.novel_id);
    if (userId && previous?.syncUserId && previous.syncUserId !== userId) previous = null;
    if (userId && previous && !previous.syncUserId && String(previous.episodeId) !== String(row.id)) previous = null;

    const candidate = {
      novelId: String(row.novel_id),
      episodeId: String(row.id),
      episodeNumber: Number(row.episode_number) || 0,
      progressRatio: contentProgress(content),
      lastReadAt: new Date().toISOString(),
      syncUserId: userId || null
    };
    const stored = { ...mergeProgress(previous, candidate), syncUserId: userId || null };
    writeProgress(stored);
    if (userId) scheduleRemoteProgress(clientInstance, userId, row.novel_id);
    return stored;
  }

  function renderEpisodeNavigation(row, rows) {
    const currentIndex = rows.findIndex((item) => String(item.id) === String(row.id));
    if (currentIndex < 0) return;
    const card = document.getElementById('card');
    if (!card || document.getElementById('nlReadingNav')) return;
    const previous = rows[currentIndex - 1] || null;
    const next = rows[currentIndex + 1] || null;
    const nav = document.createElement('nav');
    nav.id = 'nlReadingNav';
    nav.className = 'nl-reading-nav';
    nav.setAttribute('aria-label', 'エピソード移動');
    const main = document.createElement('div');
    main.className = 'nl-reading-nav-main';
    const previousLink = document.createElement(previous ? 'a' : 'span');
    previousLink.className = `nl-reading-link previous${previous ? '' : ' disabled'}`;
    if (previous) previousLink.href = episodeHref(previous.id);
    previousLink.textContent = previous ? `← 第${previous.episode_number}話` : '← 前の話なし';
    const toc = document.createElement('a');
    toc.className = 'nl-reading-link toc';
    toc.href = novelHref(row.novel_id);
    toc.textContent = '作品目次';
    const nextLink = document.createElement(next ? 'a' : 'span');
    nextLink.className = `nl-reading-link next${next ? '' : ' disabled'}`;
    if (next) nextLink.href = episodeHref(next.id);
    nextLink.textContent = next ? `第${next.episode_number}話を読む →` : '最新話まで読了';
    main.append(previousLink, toc, nextLink);
    nav.appendChild(main);
    if (!next) {
      const finished = document.createElement('p');
      finished.className = 'nl-reading-finished';
      finished.textContent = 'ここまで読んでいただきありがとうございます。お気に入りに追加すると作品を本棚から探しやすくなります。';
      nav.appendChild(finished);
    }
    card.insertAdjacentElement('afterend', nav);
  }

  async function installEpisodeContinuity(clientInstance) {
    const episodeId = new URLSearchParams(window.location.search).get('id');
    if (!episodeId) return false;
    const content = await waitFor('#card .content').catch(() => null);
    if (!content) return false;
    const rowResult = await clientInstance
      .from('episodes')
      .select('id,novel_id,title,episode_number,status')
      .eq('id', episodeId)
      .single();
    if (rowResult.error || !rowResult.data || rowResult.data.status !== 'published') return false;
    const row = rowResult.data;
    const syncState = await hydrateRemoteProgress(clientInstance, [row.novel_id]);
    const stored = readProgress(row.novel_id);
    installResumeChip(content, stored, row);
    const rows = await publishedEpisodes(clientInstance, row.novel_id);
    renderEpisodeNavigation(row, rows);
    saveEpisodeProgress(row, content, clientInstance, syncState.userId);
    let timer = null;
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        saveEpisodeProgress(row, content, clientInstance, syncState.userId);
      }, 500);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('pagehide', () => {
      saveEpisodeProgress(row, content, clientInstance, syncState.userId);
      if (syncState.userId) void pushLocalProgress(clientInstance, syncState.userId, row.novel_id);
    }, { once: true });
    return true;
  }

  function episodeRowsFromNovelPage() {
    return Array.from(document.querySelectorAll('#episodeList .episode')).map((item) => {
      const link = item.querySelector('a[href*="episode.html?id="]');
      const numberText = item.querySelector('.episode-number')?.textContent || '';
      const match = numberText.match(/第\s*(\d+)\s*話/u);
      return link && match
        ? { id: parseNovelId(link.href), href: link.href, episodeNumber: Number(match[1]), title: link.textContent.trim() }
        : null;
    }).filter(Boolean);
  }

  function continueTarget(rows, stored) {
    if (!rows.length) return null;
    if (!stored) return { row: rows[0], label: `第${rows[0].episodeNumber}話から読む`, unread: rows.length };
    const index = rows.findIndex((row) => String(row.id) === String(stored.episodeId));
    if (index < 0) return { row: rows[0], label: `第${rows[0].episodeNumber}話から読む`, unread: rows.length };
    const completedCurrent = clamp(stored.progressRatio) >= 0.85;
    const targetIndex = completedCurrent && rows[index + 1] ? index + 1 : index;
    const unread = Math.max(0, rows.length - index - (completedCurrent ? 1 : 0));
    return {
      row: rows[targetIndex],
      label: targetIndex === index ? `第${rows[index].episodeNumber}話の続きから読む` : `第${rows[targetIndex].episodeNumber}話から続きを読む`,
      unread
    };
  }

  async function installNovelContinue(clientInstance) {
    const novelId = new URLSearchParams(window.location.search).get('id');
    if (!novelId) return false;
    await waitFor('#episodeList a[href*="episode.html?id="]').catch(() => null);
    const rows = episodeRowsFromNovelPage();
    if (!rows.length || document.getElementById('nlContinueReading')) return false;
    await hydrateRemoteProgress(clientInstance, [novelId]);
    const target = continueTarget(rows, readProgress(novelId));
    if (!target) return false;
    const panel = document.createElement('div');
    panel.id = 'nlContinueReading';
    panel.className = 'nl-continue-panel';
    panel.innerHTML = `<span class="nl-continue-label">READING</span><a class="nl-continue-link" href="${target.row.href}"><strong>${target.label}</strong><span class="nl-continue-arrow" aria-hidden="true">→</span></a>`;
    const list = document.getElementById('episodeList');
    list?.insertAdjacentElement('beforebegin', panel);
    return true;
  }

  async function installFavoritesBookshelf(clientInstance) {
    const list = document.getElementById('list');
    if (!list) return false;
    await waitFor('#list a.card[href*="novel.html?id="]', { root: list }).catch(() => null);
    const cards = Array.from(list.querySelectorAll('a.card[href*="novel.html?id="]'));
    if (!cards.length) return false;

    const back = document.querySelector('header .back');
    if (back && back.getAttribute('href') === 'mypage.html') {
      back.href = 'index.html';
      back.textContent = '← NOVELIGHTへ';
    }

    const novelIds = cards.map((card) => parseNovelId(card.href)).filter(Boolean);
    await hydrateRemoteProgress(clientInstance, novelIds);
    const result = await clientInstance
      .from('episodes')
      .select('id,novel_id,title,episode_number,status')
      .in('novel_id', novelIds)
      .eq('status', 'published')
      .order('episode_number', { ascending: true });
    if (result.error) throw result.error;
    const groups = new Map();
    for (const row of result.data || []) {
      const key = String(row.novel_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        id: String(row.id),
        href: episodeHref(row.id),
        episodeNumber: Number(row.episode_number) || 0,
        title: row.title || ''
      });
    }

    for (const card of cards) {
      if (card.closest('.nl-bookshelf-item')) continue;
      const novelId = parseNovelId(card.href);
      const rows = groups.get(String(novelId)) || [];
      if (!novelId || !rows.length) continue;
      const target = continueTarget(rows, readProgress(novelId));
      if (!target) continue;
      const wrapper = document.createElement('section');
      wrapper.className = 'nl-bookshelf-item';
      card.replaceWith(wrapper);
      wrapper.appendChild(card);
      const meta = document.createElement('div');
      meta.className = 'nl-bookshelf-meta';
      const state = document.createElement('span');
      state.className = `nl-bookshelf-state${target.unread > 0 ? ' updated' : ''}`;
      state.textContent = target.unread > 0 ? `更新あり・未読 ${target.unread}話` : '最新話まで読了';
      const actions = document.createElement('div');
      actions.className = 'nl-bookshelf-actions';
      const resume = document.createElement('a');
      resume.className = 'nl-bookshelf-action primary';
      resume.href = target.row.href;
      resume.textContent = target.label;
      const detail = document.createElement('a');
      detail.className = 'nl-bookshelf-action';
      detail.href = novelHref(novelId);
      detail.textContent = '作品ページ';
      actions.append(resume, detail);
      meta.append(state, actions);
      wrapper.appendChild(meta);
    }
    return true;
  }

  async function autoInstall() {
    if (typeof client === 'undefined' || !client) return;
    installStyles();
    const slug = pageSlug();
    try {
      if (slug === 'episode') await installEpisodeContinuity(client);
      if (slug === 'novel') await installNovelContinue(client);
      if (slug === 'favorites') await installFavoritesBookshelf(client);
    } catch (error) {
      console.error('reading continuity enhancement failed', error);
    }
  }

  window.NovelightReadingContinuity = Object.freeze({
    readProgress,
    writeProgress,
    mergeProgress,
    hydrateRemoteProgress,
    pushLocalProgress,
    continueTarget,
    installEpisodeContinuity,
    installNovelContinue,
    installFavoritesBookshelf
  });

  void autoInstall();
})();
