(function () {
  'use strict';

  function runtimeMissing(error) {
    const message = String(error?.message || '');
    return (
      error?.code === '42883' ||
      error?.code === 'PGRST202' ||
      message.includes('Could not find the function') ||
      message.includes('does not exist')
    );
  }

  function normalizedState(value) {
    return {
      available: value?.available === true,
      hearted: value?.hearted === true,
      canHeart: value?.can_heart === true,
      heartCount: Math.max(0, Number(value?.heart_count) || 0)
    };
  }

  function loginRedirect(episodeId) {
    location.href =
      'login.html?redirect=' +
      encodeURIComponent('episode.html?id=' + String(episodeId));
  }

  async function mount({ client, root, episode, session, isAuthor }) {
    if (!client || !root || !episode?.id) return { ready: false };

    let state = normalizedState(null);
    let busy = false;
    root.hidden = true;
    root.replaceChildren();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'episode-heart-button';

    const status = document.createElement('span');
    status.className = 'episode-heart-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    root.append(button, status);

    function render() {
      if (!state.available) {
        root.hidden = true;
        return;
      }

      root.hidden = false;
      const mark = state.hearted ? '♥' : '♡';
      button.textContent = mark + ' ' + state.heartCount.toLocaleString('ja-JP') + ' ハート';
      button.setAttribute('aria-pressed', state.hearted ? 'true' : 'false');
      button.classList.toggle('hearted', state.hearted);
      button.disabled = busy || isAuthor || (Boolean(session) && !state.canHeart);
      button.title = isAuthor
        ? '作者本人は自分のエピソードへハートできません'
        : state.hearted
          ? 'ハートを取り消す'
          : 'この話にハートを送る';
    }

    async function loadState() {
      const result = await client.rpc('novelight_episode_heart_state', {
        p_episode_id: String(episode.id)
      });
      if (result.error) throw result.error;
      state = normalizedState(result.data);
      render();
      return state;
    }
    button.addEventListener('click', async () => {
      if (busy || isAuthor) return;
      if (!session) {
        loginRedirect(episode.id);
        return;
      }
      if (!state.canHeart) {
        status.textContent = 'この作者との直接のやり取りは現在利用できません。';
        return;
      }

      busy = true;
      status.textContent = '';
      render();
      try {
        const result = await client.rpc('novelight_toggle_episode_heart', {
          p_episode_id: String(episode.id)
        });
        if (result.error) throw result.error;
        state = {
          ...state,
          hearted: result.data?.hearted === true,
          heartCount: Math.max(0, Number(result.data?.heart_count) || 0)
        };
        status.textContent = state.hearted ? 'ハートを送りました。' : 'ハートを取り消しました。';
      } catch (error) {
        if (runtimeMissing(error)) {
          root.hidden = true;
          return;
        }
        const message = String(error?.message || '');
        if (message.includes('Authentication required')) {
          loginRedirect(episode.id);
          return;
        }
        if (message.includes('DIRECT_INTERACTION_UNAVAILABLE')) {
          status.textContent = 'この作者との直接のやり取りは現在利用できません。';
          try {
            await loadState();
          } catch {}
          return;
        }
        if (message.includes('EPISODE_HEART_SELF_NOT_ALLOWED')) {
          status.textContent = '作者本人は自分のエピソードへハートできません。';
          return;
        }
        status.textContent = 'ハートを更新できませんでした。時間をおいてお試しください。';
        console.error('episode heart toggle failed', error);
      } finally {
        busy = false;
        render();
      }
    });

    try {
      await loadState();
      return { ready: state.available };
    } catch (error) {
      if (runtimeMissing(error)) {
        root.hidden = true;
        return { ready: false, reason: 'runtime-missing' };
      }
      console.error('episode heart state unavailable', error);
      root.hidden = true;
      return { ready: false, reason: 'unavailable' };
    }
  }

  window.NovelightEpisodeHeart = Object.freeze({ mount });
})();
