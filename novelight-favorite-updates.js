(function () {
  'use strict';

  const READING_PREFIX = 'novelight:reading:v1:';
  const SEEN_PREFIX = 'novelight:favorite-update-seen:v1:';
  const STYLE_ID = 'novelight-favorite-updates-style';

  function pageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function seenKey(novelId) {
    return SEEN_PREFIX + String(novelId || '');
  }

  function readingKey(novelId) {
    return READING_PREFIX + String(novelId || '');
  }

  function readStored(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function isMissingAuthorFollowRpc(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return (
      code === 'PGRST202' ||
      code === '42883' ||
      message.includes('schema cache') ||
      message.includes('could not find the function') ||
      message.includes('does not exist')
    );
  }

  function readProgress(novelId) {
    const value = readStored(readingKey(novelId));
    if (!value || String(value.novelId) !== String(novelId)) return null;
    return value;
  }

  function readSeen(novelId) {
    const value = readStored(seenKey(novelId));
    if (!value || String(value.novelId) !== String(novelId)) return null;
    return value;
  }

  function writeSeen(novelId, episodeNumber) {
    const number = Math.max(0, Number(episodeNumber) || 0);
    try {
      window.localStorage.setItem(
        seenKey(novelId),
        JSON.stringify({
          novelId: String(novelId),
          episodeNumber: number,
          seenAt: new Date().toISOString()
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  function episodeNumber(row) {
    return Math.max(0, Number(row?.episode_number) || 0);
  }

  function latestEpisodeNumber(rows) {
    return rows.reduce((max, row) => Math.max(max, episodeNumber(row)), 0);
  }

  function updateRows(novelId, rows, { initialize = true } = {}) {
    const sorted = [...rows].sort((a, b) => episodeNumber(a) - episodeNumber(b));
    if (!sorted.length) return [];

    const progress = readProgress(novelId);
    const seen = readSeen(novelId);
    if (!seen && initialize) {
      writeSeen(novelId, latestEpisodeNumber(sorted));
      return [];
    }

    const baseline = Math.max(
      Number(progress?.episodeNumber) || 0,
      Number(seen?.episodeNumber) || 0
    );
    return sorted.filter((row) => episodeNumber(row) > baseline);
  }

  function groupEpisodes(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const key = String(row.novel_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return groups;
  }

  async function favoriteUpdates(clientInstance, { initialize = true } = {}) {
    const auth = await clientInstance.auth.getSession();
    if (auth.error) throw auth.error;
    const session = auth.data?.session || null;
    if (!session) return { session: null, updates: [] };

    const favoritesResult = await clientInstance
      .from('favorites')
      .select('novel_id,novels(id,title,status)')
      .eq('user_id', session.user.id);
    if (favoritesResult.error) throw favoritesResult.error;

    const favorites = (favoritesResult.data || []).filter(
      (row) => row.novels?.status === 'published'
    );
    const novelIds = favorites.map((row) => row.novel_id).filter(Boolean);
    if (!novelIds.length) return { session, updates: [] };

    const episodesResult = await clientInstance.rpc(
      'novelight_reader_episode_index',
      { p_novel_ids: novelIds.map(String) }
    );
    if (episodesResult.error) throw episodesResult.error;
    const safeEpisodes = (episodesResult.data || []).map((row) => ({
      id: row.episode_id,
      novel_id: row.novel_id,
      title: row.episode_title || null,
      episode_number: row.episode_number,
      status: 'published'
    }));

    const groups = groupEpisodes(safeEpisodes);
    const updates = [];
    for (const favorite of favorites) {
      const novelId = String(favorite.novel_id);
      const allEpisodes = groups.get(novelId) || [];
      if (!allEpisodes.length) continue;
      const newEpisodes = updateRows(novelId, allEpisodes, { initialize });
      if (!newEpisodes.length) continue;
      updates.push({
        novelId,
        novel: favorite.novels,
        allEpisodes,
        newEpisodes,
        firstNew: newEpisodes[0],
        latest: newEpisodes[newEpisodes.length - 1]
      });
    }

    updates.sort(
      (a, b) => episodeNumber(b.latest) - episodeNumber(a.latest)
    );
    return { session, updates };
  }

  async function followedAuthorUpdates(clientInstance) {
    const result = await clientInstance.rpc('novelight_followed_author_updates', {
      p_limit: 100
    });
    if (result.error) {
      if (isMissingAuthorFollowRpc(result.error)) return [];
      throw result.error;
    }
    return Array.isArray(result.data) ? result.data : [];
  }

  function eventId(row) {
    try {
      return BigInt(String(row?.event_id || '0'));
    } catch {
      return 0n;
    }
  }

  function groupAuthorUpdates(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const authorId = String(row?.author_user_id || '');
      if (!authorId) continue;
      if (!groups.has(authorId)) {
        groups.set(authorId, {
          authorId,
          authorDisplayName: row?.author_display_name || '名前未設定',
          events: [],
          maxNewWorkEventId: null,
          maxUpdateEventId: null
        });
      }
      const group = groups.get(authorId);
      group.events.push(row);
      if (row?.event_type === 'novel_published') {
        if (
          group.maxNewWorkEventId === null ||
          eventId(row) > eventId({ event_id: group.maxNewWorkEventId })
        ) {
          group.maxNewWorkEventId = String(row.event_id);
        }
      }
      if (row?.event_type === 'episode_published') {
        if (
          group.maxUpdateEventId === null ||
          eventId(row) > eventId({ event_id: group.maxUpdateEventId })
        ) {
          group.maxUpdateEventId = String(row.event_id);
        }
      }
    }

    return [...groups.values()]
      .map((group) => {
        group.events.sort((a, b) => {
          const aId = eventId(a);
          const bId = eventId(b);
          return aId === bId ? 0 : aId > bId ? -1 : 1;
        });
        group.latest = group.events[0] || null;
        return group;
      })
      .sort((a, b) => {
        const aId = eventId(a.latest);
        const bId = eventId(b.latest);
        return aId === bId ? 0 : aId > bId ? -1 : 1;
      });
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-update-link{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:7px 10px;border:1px solid rgba(214,164,71,.34);border-radius:9px;color:#f7e5b1!important;font-size:12px;font-weight:900;text-decoration:none!important}
      .nl-update-link:hover{border-color:#d6a447;background:rgba(214,164,71,.08)}
      .nl-update-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#d6a447;color:#101b28;font-size:10px;font-weight:950}
      .nl-update-mobile-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin-left:6px;padding:0 6px;border-radius:999px;background:#d6a447;color:#101b28;font-size:10px;font-weight:950}
    `;
    document.head.appendChild(style);
  }

  function installHomeBadge(updateCount) {
    const count = Math.max(0, Number(updateCount) || 0);
    if (!count || document.getElementById('nlFavoriteUpdatesLink')) return false;
    const actions = document.querySelector('.header-actions');
    if (!actions) return false;
    installStyles();

    const link = document.createElement('a');
    link.id = 'nlFavoriteUpdatesLink';
    link.className = 'nl-update-link';
    link.href = 'updates.html';
    link.setAttribute('aria-label', `新しい更新 ${count}件`);
    const label = document.createElement('span');
    label.textContent = '更新';
    const badge = document.createElement('span');
    badge.className = 'nl-update-badge';
    badge.textContent = String(count);
    link.append(label, badge);
    actions.insertBefore(link, actions.querySelector('.header-search'));

    const mobileNav = document.querySelector('.mobile-menu nav');
    if (mobileNav && !document.getElementById('nlFavoriteUpdatesMobileLink')) {
      const mobileLink = document.createElement('a');
      mobileLink.id = 'nlFavoriteUpdatesMobileLink';
      mobileLink.href = 'updates.html';
      mobileLink.append(document.createTextNode('更新通知'));
      const mobileBadge = document.createElement('span');
      mobileBadge.className = 'nl-update-mobile-badge';
      mobileBadge.textContent = String(count);
      mobileLink.appendChild(mobileBadge);
      mobileNav.insertBefore(mobileLink, mobileNav.firstChild);
    }
    return true;
  }

  function setSummary(favoriteItems, authorGroups) {
    const summary = document.getElementById('updatesSummary');
    if (!summary) return;
    const favoriteEpisodes = favoriteItems.reduce(
      (sum, item) => sum + item.newEpisodes.length,
      0
    );
    const authorEvents = authorGroups.reduce(
      (sum, group) => sum + group.events.length,
      0
    );
    if (!favoriteItems.length && !authorEvents) {
      summary.textContent = '確認していない更新はありません。';
      return;
    }
    const parts = [];
    if (favoriteItems.length) {
      parts.push(`お気に入り ${favoriteItems.length}作品・${favoriteEpisodes}話`);
    }
    if (authorEvents) {
      parts.push(`フォロー作者 ${authorEvents}件`);
    }
    summary.textContent = `${parts.join(' / ')}の新着があります。`;
  }

  function renderEmpty(list) {
    list.replaceChildren();
    const empty = document.createElement('section');
    empty.className = 'updates-empty';
    const title = document.createElement('strong');
    title.textContent = '新しい更新はありません';
    const copy = document.createElement('p');
    copy.textContent =
      'お気に入り作品の更新や、フォロー中の作者による新作・新しい話がここに表示されます。';
    const actions = document.createElement('div');
    actions.className = 'updates-empty-actions';
    const favorites = document.createElement('a');
    favorites.href = 'favorites.html';
    favorites.textContent = '本棚を見る';
    const search = document.createElement('a');
    search.href = 'search.html';
    search.textContent = '作品を探す';
    actions.append(favorites, search);
    empty.append(title, copy, actions);
    list.appendChild(empty);
  }

  function renderUpdateCard(item, onAcknowledge) {
    const article = document.createElement('article');
    article.className = 'update-card';
    article.dataset.novelId = item.novelId;

    const top = document.createElement('div');
    top.className = 'update-card-top';
    const copy = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'update-card-badge';
    badge.textContent = `更新 ${item.newEpisodes.length}話`;
    const title = document.createElement('a');
    title.className = 'update-card-title';
    title.href = `novel.html?id=${encodeURIComponent(item.novelId)}`;
    title.textContent = item.novel?.title || 'タイトル未設定';
    const range = document.createElement('p');
    range.className = 'update-card-range';
    range.textContent =
      item.newEpisodes.length === 1
        ? `第${episodeNumber(item.firstNew)}話が公開されました。`
        : `第${episodeNumber(item.firstNew)}話〜第${episodeNumber(item.latest)}話が未確認です。`;
    copy.append(badge, title, range);
    top.appendChild(copy);

    const actions = document.createElement('div');
    actions.className = 'update-card-actions';
    const read = document.createElement('a');
    read.className = 'update-card-read';
    read.href = `episode.html?id=${encodeURIComponent(item.firstNew.id)}`;
    read.textContent = '更新分から読む →';
    const acknowledge = document.createElement('button');
    acknowledge.className = 'update-card-seen';
    acknowledge.type = 'button';
    acknowledge.textContent = '確認済みにする';
    acknowledge.addEventListener('click', () => onAcknowledge(item, article));
    actions.append(read, acknowledge);
    article.append(top, actions);
    return article;
  }

  function renderAuthorUpdateCard(group, onAcknowledge) {
    const article = document.createElement('article');
    article.className = 'update-card';
    article.dataset.authorId = group.authorId;

    const latest = group.latest;
    const top = document.createElement('div');
    top.className = 'update-card-top';
    const copy = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'update-card-badge';
    badge.textContent = `フォロー作者 ${group.events.length}件`;
    const title = document.createElement('a');
    title.className = 'update-card-title';
    title.href = `author.html?id=${encodeURIComponent(group.authorId)}`;
    title.textContent = group.authorDisplayName;
    const range = document.createElement('p');
    range.className = 'update-card-range';
    if (latest?.event_type === 'novel_published') {
      range.textContent = `新作「${latest.novel_title || 'タイトル未設定'}」が公開されました。`;
    } else {
      const episodeLabel = latest?.episode_number
        ? `第${latest.episode_number}話`
        : '新しい話';
      range.textContent = `「${latest?.novel_title || 'タイトル未設定'}」の${episodeLabel}が公開されました。`;
    }
    if (group.events.length > 1) {
      range.textContent += ` ほか${group.events.length - 1}件`;
    }
    copy.append(badge, title, range);
    top.appendChild(copy);

    const actions = document.createElement('div');
    actions.className = 'update-card-actions';
    const read = document.createElement('a');
    read.className = 'update-card-read';
    read.href =
      latest?.event_type === 'episode_published' && latest?.episode_id
        ? `episode.html?id=${encodeURIComponent(latest.episode_id)}`
        : `novel.html?id=${encodeURIComponent(latest?.novel_id || '')}`;
    read.textContent = '確認する →';
    const acknowledge = document.createElement('button');
    acknowledge.className = 'update-card-seen';
    acknowledge.type = 'button';
    acknowledge.textContent = '確認済みにする';
    acknowledge.addEventListener('click', () =>
      onAcknowledge(group, article, acknowledge)
    );
    actions.append(read, acknowledge);
    article.append(top, actions);
    return article;
  }

  async function installUpdatesPage(clientInstance) {
    const list = document.getElementById('updatesList');
    if (!list) return false;
    try {
      const result = await favoriteUpdates(clientInstance, { initialize: true });
      if (!result.session) {
        window.location.href = 'login.html?redirect=updates.html';
        return false;
      }
      const authorRows = await followedAuthorUpdates(clientInstance);
      void window.NovelightClient?.recordVisit?.(clientInstance);
      void window.NovelightClient?.claimAcquisition?.(clientInstance);

      let activeFavorites = [...result.updates];
      let activeAuthors = groupAuthorUpdates(authorRows);
      const rerenderSummary = () =>
        setSummary(activeFavorites, activeAuthors);
      const maybeRenderEmpty = () => {
        if (!activeFavorites.length && !activeAuthors.length) renderEmpty(list);
      };
      const acknowledgeFavorite = (item, card) => {
        writeSeen(item.novelId, latestEpisodeNumber(item.allEpisodes));
        activeFavorites = activeFavorites.filter(
          (candidate) => candidate.novelId !== item.novelId
        );
        card.remove();
        rerenderSummary();
        maybeRenderEmpty();
      };
      const acknowledgeAuthor = async (group, card, button) => {
        button.disabled = true;
        button.textContent = '保存中...';
        const response = await clientInstance.rpc(
          'novelight_mark_author_follow_updates_seen',
          {
            p_author_user_id: group.authorId,
            p_new_work_event_id: group.maxNewWorkEventId,
            p_update_event_id: group.maxUpdateEventId
          }
        );
        if (response.error) {
          console.error('author update acknowledgement failed', response.error);
          button.disabled = false;
          button.textContent = '再試行';
          return;
        }
        activeAuthors = activeAuthors.filter(
          (candidate) => candidate.authorId !== group.authorId
        );
        card.remove();
        rerenderSummary();
        maybeRenderEmpty();
      };

      list.replaceChildren();
      for (const group of activeAuthors) {
        list.appendChild(renderAuthorUpdateCard(group, acknowledgeAuthor));
      }
      for (const item of activeFavorites) {
        list.appendChild(renderUpdateCard(item, acknowledgeFavorite));
      }
      maybeRenderEmpty();
      rerenderSummary();
      return true;
    } catch (error) {
      console.error('update center failed', error);
      list.innerHTML = '<section class="updates-empty"><strong>更新情報を読み込めませんでした</strong><p>通信状況を確認して、もう一度お試しください。</p></section>';
      const summary = document.getElementById('updatesSummary');
      if (summary) summary.textContent = '更新情報を取得できませんでした。';
      return false;
    }
  }

  async function installHomeUpdates(clientInstance) {
    try {
      const result = await favoriteUpdates(clientInstance, { initialize: true });
      if (!result.session) return false;
      const authorRows = await followedAuthorUpdates(clientInstance);
      return installHomeBadge(result.updates.length + authorRows.length);
    } catch (error) {
      console.error('update badge failed', error);
      return false;
    }
  }

  window.NovelightFavoriteUpdates = Object.freeze({
    readProgress,
    readSeen,
    writeSeen,
    updateRows,
    favoriteUpdates,
    isMissingAuthorFollowRpc,
    followedAuthorUpdates,
    groupAuthorUpdates,
    installHomeBadge,
    installHomeUpdates,
    installUpdatesPage
  });

  const slug = pageSlug();
  if (typeof client !== 'undefined' && client) {
    if (slug === 'index') void installHomeUpdates(client);
    if (slug === 'updates') void installUpdatesPage(client);
  }
})();