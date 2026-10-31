/* Private followed-author list. Both bookshelf and community link here. */
(() => {
  'use strict';
  if (!window.supabase) return;
  const root = document.getElementById('followingList');
  const summary = document.getElementById('followingSummary');
  const more = document.getElementById('followingLoadMore');
  if (!root || !summary || !more) return;
  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  void window.NovelightClient?.syncAuthHeader(client);
  const tabs = [...document.querySelectorAll('[data-follow-view]')];
  const followersCount = document.getElementById('followersCount');
  const followingCount = document.getElementById('followingCount');
  let activeView = new URLSearchParams(location.search).get('tab') === 'following'
    ? 'following' : 'followers';
  let requestRevision = 0;
  const PAGE_SIZE = 25;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let offset = 0;
  let loading = false;

  function isMissingFollowRpc(error) {
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

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function empty(message, linkHref, linkText) {
    const box = element('div', 'follow-empty', message);
    if (linkHref) {
      box.append(' ', Object.assign(element('a', '', linkText), { href: linkHref }));
    }
    root.replaceChildren(box);
  }

  function setBusy(card, busy) {
    card.querySelectorAll('button,input').forEach(control => {
      control.disabled = busy;
    });
  }

  function showAuthor(row) {
    const id = String(row.author_user_id || '');
    if (!UUID.test(id)) return null;
    const name = String(row.display_name || '名前未設定');
    const card = element('article', 'follow-card');
    const avatar = element('span', 'follow-avatar', name.trim().slice(0, 1) || '作');
    avatar.setAttribute('aria-hidden', 'true');
    window.NovelightPublicAvatar?.paint(avatar, row.avatar_path, id, name, client);
    const content = element('div');
    const author = element('a', 'follow-name', name);
    author.href = 'author.html?id=' + encodeURIComponent(id);
    const desc = element('p', 'follow-card-desc', 'フォロー中の作者');
    const controls = element('div', 'follow-controls');
    const newWorks = element('input');
    newWorks.type = 'checkbox';
    newWorks.checked = row.notify_new_works === true;
    const newWorksLabel = element('label', 'follow-option');
    newWorksLabel.append(newWorks, document.createTextNode(' 新作通知'));
    const updates = element('input');
    updates.type = 'checkbox';
    updates.checked = row.notify_updates === true;
    const updatesLabel = element('label', 'follow-option');
    updatesLabel.append(updates, document.createTextNode(' 更新通知'));
    const unfollow = element('button', 'follow-unfollow', 'フォロー解除');
    unfollow.type = 'button';
    const status = element('p', 'follow-status');
    status.setAttribute('role', 'status');
    controls.append(newWorksLabel, updatesLabel, unfollow);
    content.append(author, desc, controls, status);
    card.append(avatar, content);

    async function saveNotifications() {
      setBusy(card, true);
      status.textContent = '通知設定を保存しています...';
      try {
        const { data, error } = await client.rpc('novelight_set_author_follow_notifications', {
          p_author_user_id: id,
          p_notify_new_works: newWorks.checked,
          p_notify_updates: updates.checked
        });
        if (error) throw error;
        const state = Array.isArray(data) ? data[0] : data;
        if (state?.following !== true) throw new Error('Invalid follow state');
        row.notify_new_works = state.notify_new_works;
        row.notify_updates = state.notify_updates;
        newWorks.checked = row.notify_new_works === true;
        updates.checked = row.notify_updates === true;
        status.textContent = '通知設定を保存しました。';
      } catch (error) {
        console.warn('following notification update failed', error);
        newWorks.checked = row.notify_new_works === true;
        updates.checked = row.notify_updates === true;
        status.textContent = '通知設定を保存できませんでした。もう一度お試しください。';
      } finally {
        setBusy(card, false);
      }
    }

    newWorks.addEventListener('change', () => void saveNotifications());
    updates.addEventListener('change', () => void saveNotifications());
    unfollow.addEventListener('click', async () => {
      if (!window.confirm(name + 'さんのフォローを解除しますか？')) return;
      setBusy(card, true);
      status.textContent = 'フォローを解除しています...';
      try {
        const { data, error } = await client.rpc('novelight_set_author_follow', {
          p_author_user_id: id,
          p_following: false
        });
        if (error) throw error;
        const state = Array.isArray(data) ? data[0] : data;
        if (state?.following !== false) throw new Error('Invalid unfollow receipt');
        await load(true);
        await refreshCounts();
      } catch (error) {
        console.warn('following unfollow failed', error);
        status.textContent = 'フォローを解除できませんでした。もう一度お試しください。';
      } finally {
        setBusy(card, false);
      }
    });
    return card;
  }


  // The list of followers is private to the signed-in user. It does not expose
  // another author's follower relationships or notification preferences.
  function showFollower(row) {
    const id = String(row.user_id || '');
    if (!UUID.test(id)) return null;
    const name = String(row.display_name || '名前未設定');
    const card = element('article', 'follow-card');
    const avatar = element('span', 'follow-avatar', name.trim().slice(0, 1) || '読');
    avatar.setAttribute('aria-hidden', 'true');
    window.NovelightPublicAvatar?.paint(avatar, row.avatar_path, id, name, client);
    const content = element('div');
    const profile = element('a', 'follow-name', name);
    profile.href = 'author.html?id=' + encodeURIComponent(id);
    content.append(profile, element('p', 'follow-card-desc', 'あなたをフォローしています'));
    card.append(avatar, content);
    return card;
  }

  async function refreshCounts() {
    try {
      const { data, error } = await client.rpc('novelight_follow_counts');
      if (error) throw error;
      if (!data || !Number.isSafeInteger(Number(data.followers))
        || !Number.isSafeInteger(Number(data.following))) {
        throw new Error('Invalid follow counts');
      }
      if (followersCount) followersCount.textContent = String(data.followers);
      if (followingCount) followingCount.textContent = String(data.following);
    } catch (error) {
      console.warn('follow counts unavailable', error);
      if (followersCount) followersCount.textContent = '—';
      if (followingCount) followingCount.textContent = '—';
    }
  }

  function setCurrentTab() {
    for (const tab of tabs) {
      const selected = tab.dataset.followView === activeView;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    root.setAttribute('aria-labelledby', activeView === 'followers'
      ? 'followersTab' : 'followingTab');
  }

  function selectView(view, updateUrl = true) {
    if (!['followers', 'following'].includes(view)) return;
    activeView = view;
    offset = 0;
    loading = false;
    more.hidden = true;
    root.replaceChildren();
    setCurrentTab();
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('tab', activeView);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    void load(true);
  }

  async function load(reset = false) {
    if (loading && !reset) return;
    const revision = ++requestRevision;
    const current = activeView;
    loading = true;
    more.disabled = true;
    if (reset) {
      offset = 0;
      root.replaceChildren();
      more.hidden = true;
    }
    summary.textContent = current === 'followers'
      ? 'フォロワーを読み込んでいます...'
      : 'フォロー中の作者を読み込んでいます...';
    const nextOffset = offset;
    try {
      const fn = current === 'followers'
        ? 'novelight_followers' : 'novelight_followed_authors';
      const { data, error } = await client.rpc(fn, {
        p_limit: PAGE_SIZE,
        p_offset: nextOffset
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Invalid follow list response');
      // A slower response from the previously selected tab must not overwrite
      // the currently selected tab or its pagination cursor.
      if (revision !== requestRevision || current !== activeView) return;
      const fragment = document.createDocumentFragment();
      for (const row of data) {
        const card = current === 'followers' ? showFollower(row) : showAuthor(row);
        if (card) fragment.appendChild(card);
      }
      root.appendChild(fragment);
      offset = nextOffset + data.length;
      const displayed = root.querySelectorAll('.follow-card').length;
      if (!displayed) {
        if (current === 'followers') {
          empty('まだフォロワーはいません。');
        } else {
          empty('まだフォローしている作者はいません。', 'search.html', '作品を探す');
        }
      }
      summary.textContent = current === 'followers'
        ? (displayed ? 'フォロワー ' + displayed + '人を表示中' : 'フォロワーはいません')
        : (displayed ? 'フォロー中 ' + displayed + '人を表示中' : 'フォロー中の作者はいません');
      more.hidden = data.length < PAGE_SIZE;
    } catch (error) {
      if (revision !== requestRevision) return;
      console.warn('follow list unavailable', error);
      if (isMissingFollowRpc(error)) {
        empty('フォロー一覧はデータベース反映待ちです。公開後にご利用いただけます。');
        summary.textContent = 'データベース反映待ち';
      } else {
        if (reset || offset === 0) {
          empty('一覧を取得できませんでした。時間をおいて再度お試しください。');
        }
        summary.textContent = '一覧を取得できませんでした。';
      }
      more.hidden = true;
    } finally {
      if (revision === requestRevision) {
        loading = false;
        more.disabled = false;
      }
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectView(tab.dataset.followView));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const other = tab.dataset.followView === 'followers' ? 'following' : 'followers';
      selectView(other);
      tabs.find(item => item.dataset.followView === other)?.focus();
    });
  }
  more.addEventListener('click', () => void load(false));
  (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data?.session?.user) {
        setCurrentTab();
        summary.textContent = '一覧を見るにはログインが必要です。';
        empty('ログインすると、フォロワーとフォロー中の作者を確認できます。',
          'login.html?redirect=following.html%3Ftab%3D' + activeView, 'ログインする');
        more.hidden = true;
        return;
      }
      void refreshCounts();
      selectView(activeView, false);
    } catch (error) {
      console.warn('follow session unavailable', error);
      summary.textContent = 'ログイン状態を確認できませんでした。';
      empty('ログイン状態を確認できませんでした。再読み込みしてください。');
    }
  })();
})();
