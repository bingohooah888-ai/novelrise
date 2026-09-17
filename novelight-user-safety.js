(function attachNovelightUserSafety(global) {
  'use strict';

  const sessionByClient = new WeakMap();

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function normalizeRelationship(value) {
    const row = Array.isArray(value) ? value[0] : value;
    return {
      blocked: row?.blocked === true,
      muted: row?.muted === true
    };
  }

  async function currentSession(client) {
    if (!client) return null;
    if (!sessionByClient.has(client)) {
      sessionByClient.set(
        client,
        client.auth
          .getSession()
          .then((result) => result.data?.session || null)
          .catch((error) => {
            console.error('user safety session lookup failed', error);
            return null;
          })
      );
    }
    return sessionByClient.get(client);
  }

  function rowNovelId(row) {
    return String(row?.novel_id ?? row?.id ?? '');
  }

  async function filterNovelRows(client, rows) {
    const input = Array.isArray(rows) ? rows : [];
    if (!client || !input.length) return input;

    const session = await currentSession(client);
    if (!session) return input;

    const novelIds = input.map(rowNovelId).filter(Boolean).slice(0, 100);
    if (!novelIds.length) return input;

    const result = await client.rpc('novelight_hidden_novel_ids', {
      p_novel_ids: novelIds
    });
    if (result.error) {
      console.error('user safety novel filter failed', result.error);
      return input;
    }

    const hidden = new Set(
      (Array.isArray(result.data) ? result.data : []).map(String)
    );
    return input.filter((row) => !hidden.has(rowNovelId(row)));
  }

  async function mountAuthorControls({ client, targetUserId, container }) {
    if (!client || !targetUserId || !container) return;

    const session = await currentSession(client);
    const currentUserId = session?.user?.id;
    if (!currentUserId || currentUserId === targetUserId) return;

    const wrapper = createElement('div', 'user-safety-controls');
    wrapper.setAttribute('aria-label', '表示と交流の設定');
    const title = createElement('strong', 'user-safety-title', '表示と交流の設定');
    const explanation = createElement(
      'p',
      'user-safety-explanation',
      'ブロックは直接的な交流を止め、ミュートはこの作者の作品やコメントを自分の画面で非表示にします。作品の評価・Rank・LIGHT SEEDには影響しません。'
    );
    const actions = createElement('div', 'user-safety-actions');
    const blockButton = createElement('button', 'user-safety-button', 'ブロック');
    const muteButton = createElement('button', 'user-safety-button', 'ミュート');
    blockButton.type = 'button';
    muteButton.type = 'button';
    const status = createElement('div', 'user-safety-status', '');
    status.setAttribute('aria-live', 'polite');
    actions.append(blockButton, muteButton);
    wrapper.append(title, explanation, actions, status);
    container.append(wrapper);

    let relationship = { blocked: false, muted: false };

    function render() {
      blockButton.textContent = relationship.blocked ? 'ブロックを解除' : 'ブロック';
      muteButton.textContent = relationship.muted ? 'ミュートを解除' : 'ミュート';
      blockButton.setAttribute('aria-pressed', String(relationship.blocked));
      muteButton.setAttribute('aria-pressed', String(relationship.muted));
    }

    async function loadRelationship() {
      const result = await client.rpc('novelight_user_relationship', {
        p_target_user_id: targetUserId
      });
      if (result.error) throw result.error;
      relationship = normalizeRelationship(result.data);
      render();
    }

    async function setRelationship(kind, nextValue) {
      const rpcName =
        kind === 'block' ? 'novelight_set_user_block' : 'novelight_set_user_mute';
      const args =
        kind === 'block'
          ? { p_target_user_id: targetUserId, p_blocked: nextValue }
          : { p_target_user_id: targetUserId, p_muted: nextValue };
      const result = await client.rpc(rpcName, args);
      if (result.error) throw result.error;
      relationship = normalizeRelationship(result.data);
      render();
    }

    blockButton.addEventListener('click', async () => {
      const nextValue = !relationship.blocked;
      if (
        nextValue &&
        !global.confirm('この作者との直接的な交流をブロックしますか？')
      ) {
        return;
      }
      blockButton.disabled = true;
      muteButton.disabled = true;
      status.textContent = nextValue
        ? 'ブロックしています...'
        : 'ブロックを解除しています...';
      try {
        await setRelationship('block', nextValue);
        status.textContent = nextValue ? 'ブロックしました。' : 'ブロックを解除しました。';
      } catch (error) {
        console.error('user block update failed', error);
        status.textContent =
          'ブロック設定を変更できませんでした。時間をおいて再度お試しください。';
      } finally {
        blockButton.disabled = false;
        muteButton.disabled = false;
      }
    });

    muteButton.addEventListener('click', async () => {
      const nextValue = !relationship.muted;
      blockButton.disabled = true;
      muteButton.disabled = true;
      status.textContent = nextValue
        ? 'ミュートしています...'
        : 'ミュートを解除しています...';
      try {
        await setRelationship('mute', nextValue);
        status.textContent = nextValue ? 'ミュートしました。' : 'ミュートを解除しました。';
      } catch (error) {
        console.error('user mute update failed', error);
        status.textContent =
          'ミュート設定を変更できませんでした。時間をおいて再度お試しください。';
      } finally {
        blockButton.disabled = false;
        muteButton.disabled = false;
      }
    });

    try {
      await loadRelationship();
    } catch (error) {
      console.error('user relationship lookup failed', error);
      wrapper.remove();
    }
  }

  global.NovelightUserSafety = Object.freeze({
    filterNovelRows,
    mountAuthorControls
  });
})(window);
