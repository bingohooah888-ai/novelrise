(function attachNovelightAuthorFollow(global) {
  'use strict';

  const sessionByClient = new WeakMap();

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function normalizeState(value) {
    const row = Array.isArray(value) ? value[0] : value;
    return {
      following: row?.following === true,
      notifyNewWorks: row?.notify_new_works !== false,
      notifyUpdates: row?.notify_updates !== false
    };
  }

  function isMissingRpc(error) {
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

  async function currentSession(client) {
    if (!sessionByClient.has(client)) {
      sessionByClient.set(
        client,
        client.auth
          .getSession()
          .then((result) => result.data?.session || null)
          .catch((error) => {
            console.error('author follow session lookup failed', error);
            return null;
          })
      );
    }
    return sessionByClient.get(client);
  }

  function loginHref(targetUserId) {
    const redirect = `author.html?id=${encodeURIComponent(targetUserId)}`;
    return `login.html?redirect=${encodeURIComponent(redirect)}`;
  }

  async function mountAuthorFollowControls({ client, targetUserId, container }) {
    if (!client || !targetUserId || !container) return false;

    const session = await currentSession(client);
    if (session?.user?.id === targetUserId) return false;

    const wrapper = createElement('section', 'author-follow-controls');
    wrapper.setAttribute('aria-label', '作者フォロー');
    const top = createElement('div', 'author-follow-top');
    const title = createElement('strong', 'author-follow-title', '作者をフォロー');
    const followButton = createElement('button', 'author-follow-button', 'フォロー');
    followButton.type = 'button';
    const status = createElement('div', 'author-follow-status', '');
    status.setAttribute('aria-live', 'polite');
    top.append(title, followButton);

    const explanation = createElement(
      'p',
      'author-follow-explanation',
      '新作や更新をサイト内で確認できます。フォロー数は作品評価・Rank・LIGHT SEED・露出には影響しません。'
    );
    const preferences = createElement('div', 'author-follow-preferences');
    const newWorkLabel = createElement('label', 'author-follow-preference');
    const newWorkInput = document.createElement('input');
    newWorkInput.type = 'checkbox';
    newWorkInput.checked = true;
    newWorkLabel.append(newWorkInput, document.createTextNode(' 新作通知'));

    const updatesLabel = createElement('label', 'author-follow-preference');
    const updatesInput = document.createElement('input');
    updatesInput.type = 'checkbox';
    updatesInput.checked = true;
    updatesLabel.append(updatesInput, document.createTextNode(' 更新通知'));
    preferences.append(newWorkLabel, updatesLabel);

    wrapper.append(top, explanation, preferences, status);
    container.append(wrapper);

    if (!session) {
      followButton.textContent = 'ログインしてフォロー';
      preferences.hidden = true;
      followButton.addEventListener('click', () => {
        global.location.href = loginHref(targetUserId);
      });
      return true;
    }

    let state = {
      following: false,
      notifyNewWorks: true,
      notifyUpdates: true
    };

    function render() {
      followButton.textContent = state.following ? 'フォロー中' : 'フォロー';
      followButton.setAttribute('aria-pressed', String(state.following));
      preferences.hidden = !state.following;
      newWorkInput.checked = state.notifyNewWorks;
      updatesInput.checked = state.notifyUpdates;
    }
    function setBusy(value) {
      followButton.disabled = value;
      newWorkInput.disabled = value;
      updatesInput.disabled = value;
    }

    async function loadState() {
      const result = await client.rpc('novelight_author_follow_state', {
        p_author_user_id: targetUserId
      });
      if (result.error) throw result.error;
      state = normalizeState(result.data);
      render();
    }

    async function setFollow(nextFollowing) {
      const result = await client.rpc('novelight_set_author_follow', {
        p_author_user_id: targetUserId,
        p_following: nextFollowing
      });
      if (result.error) throw result.error;
      state = normalizeState(result.data);
      render();
    }

    async function savePreferences() {
      const result = await client.rpc(
        'novelight_set_author_follow_notifications',
        {
          p_author_user_id: targetUserId,
          p_notify_new_works: newWorkInput.checked,
          p_notify_updates: updatesInput.checked
        }
      );
      if (result.error) throw result.error;
      state = normalizeState(result.data);
      render();
    }

    followButton.addEventListener('click', async () => {
      const nextFollowing = !state.following;
      setBusy(true);
      status.textContent = nextFollowing
        ? 'フォローしています...'
        : 'フォローを解除しています...';
      try {
        await setFollow(nextFollowing);
        status.textContent = nextFollowing
          ? 'フォローしました。'
          : 'フォローを解除しました。';
      } catch (error) {
        console.error('author follow update failed', error);
        status.textContent =
          error?.message === 'DIRECT_INTERACTION_UNAVAILABLE'
            ? 'この作者を現在フォローできません。'
            : 'フォロー設定を変更できませんでした。時間をおいて再度お試しください。';
      } finally {
        setBusy(false);
      }
    });

    const preferenceHandler = async () => {
      setBusy(true);
      status.textContent = '通知設定を保存しています...';
      try {
        await savePreferences();
        status.textContent = '通知設定を保存しました。';
      } catch (error) {
        console.error('author follow notification setting failed', error);
        render();
        status.textContent =
          '通知設定を変更できませんでした。時間をおいて再度お試しください。';
      } finally {
        setBusy(false);
      }
    };
    newWorkInput.addEventListener('change', preferenceHandler);
    updatesInput.addEventListener('change', preferenceHandler);

    try {
      await loadState();
      return true;
    } catch (error) {
      if (!isMissingRpc(error)) {
        console.error('author follow state lookup failed', error);
      }
      wrapper.remove();
      return false;
    }
  }

  global.NovelightAuthorFollow = Object.freeze({
    isMissingRpc,
    normalizeState,
    mountAuthorFollowControls
  });
})(window);
