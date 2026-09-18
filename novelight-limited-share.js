(() => {
  'use strict';

  const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function isMissingRpc(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    return (
      MISSING_RPC_CODES.has(code) ||
      message.includes('could not find the function') ||
      message.includes('function') && message.includes('does not exist')
    );
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ja-JP');
  }

  function normalizeToken(value) {
    const token = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/u.test(token) ? token : '';
  }

  function buildShareUrl(token, href = globalThis.location?.href || '') {
    const normalized = normalizeToken(token);
    if (!normalized) return '';
    const url = new URL('shared.html', href);
    url.hash = new URLSearchParams({ token: normalized }).toString();
    return url.toString();
  }

  function buildReaderHash(token, episodeNumber = null) {
    const params = new URLSearchParams({ token });
    if (episodeNumber !== null && episodeNumber !== undefined) {
      params.set('episode', String(episodeNumber));
    }
    return `#${params.toString()}`;
  }

  async function copyText(value) {
    if (!value) return false;
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(value);
      return true;
    }
    return false;
  }

  async function mountManager({ client, novelId, session, mount }) {
    const host = mount || document.querySelector('[data-limited-share-manager]');
    if (!host) return;

    host.replaceChildren();
    const status = createElement('p', 'limited-share-status', '読み込み中...');
    host.append(status);

    if (!session?.user?.id) {
      status.textContent = 'ログインが必要です。';
      return;
    }

    let novel;
    try {
      const response = await client
        .from('novels')
        .select('id,title,status,user_id')
        .eq('id', novelId)
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (response.error) throw response.error;
      novel = response.data;
    } catch (error) {
      console.error('limited share novel load failed', error);
      status.textContent = '作品を確認できませんでした。';
      return;
    }

    if (!novel) {
      status.textContent = 'この作品を管理する権限がありません。';
      return;
    }

    const card = createElement('section', 'limited-share-card');
    const title = createElement('h2', '', novel.title || '無題');
    const intro = createElement(
      'p',
      'limited-share-copy',
      '下書き作品を、リンクを知っている相手だけに確認してもらえます。共有中も通常の検索・Rank・SCOUT・PV・お気に入り・発掘棚・露出の対象にはなりません。'
    );
    const warning = createElement(
      'p',
      'limited-share-warning',
      '共有リンクでは、この作品に現在保存されている全エピソード本文を閲覧できます。信頼できる相手にだけ送ってください。'
    );
    const stateRow = createElement('div', 'limited-share-state-row');
    const badge = createElement('span', 'limited-share-badge', '確認中');
    stateRow.append(badge);
    const detail = createElement('p', 'limited-share-detail');
    const actions = createElement('div', 'limited-share-actions');
    const rotate = createElement('button', 'limited-share-primary', '共有リンクを発行');
    rotate.type = 'button';
    const revoke = createElement('button', 'limited-share-secondary', '共有を停止');
    revoke.type = 'button';
    const fresh = createElement('div', 'limited-share-fresh');
    fresh.hidden = true;
    const urlLabel = createElement('label', 'limited-share-url-label', '今回発行した共有URL');
    const urlInput = createElement('input', 'limited-share-url');
    urlInput.type = 'text';
    urlInput.readOnly = true;
    const copy = createElement('button', 'limited-share-secondary', 'URLをコピー');
    copy.type = 'button';
    const freshNote = createElement(
      'p',
      'limited-share-note',
      'このURLは安全のため再表示できません。閉じる前にコピーしてください。再発行すると以前のURLは無効になります。'
    );
    fresh.append(urlLabel, urlInput, copy, freshNote);
    card.append(title, intro, warning, stateRow, detail, actions, fresh);
    host.replaceChildren(card);

    async function loadStatus() {
      const result = await client.rpc('novelight_share_link_status', {
        p_novel_id: Number(novelId)
      });
      if (result.error) {
        if (isMissingRpc(result.error)) {
          badge.textContent = 'DB反映待ち';
          badge.className = 'limited-share-badge is-pending';
          detail.textContent =
            '限定共有機能はデータベース反映待ちです。反映完了後に利用できます。';
          rotate.disabled = true;
          revoke.hidden = true;
          return null;
        }
        throw result.error;
      }

      const data = result.data || {};
      if (!data.eligible || novel.status !== 'draft') {
        badge.textContent = '利用対象外';
        badge.className = 'limited-share-badge is-off';
        detail.textContent =
          '限定共有は下書き作品専用です。公開中の作品は通常の作品ページを共有してください。';
        rotate.disabled = true;
        revoke.hidden = true;
        return data;
      }

      rotate.disabled = false;
      revoke.hidden = !data.enabled;
      rotate.textContent = data.enabled ? '共有リンクを再発行' : '共有リンクを発行';
      if (data.enabled) {
        badge.textContent = '限定共有中';
        badge.className = 'limited-share-badge is-on';
        detail.textContent = data.rotated_at
          ? `現在リンクが有効です（最終発行: ${formatDate(data.rotated_at)}）。生トークンは保存していないため、URLが必要な場合は再発行してください。`
          : '現在リンクが有効です。URLが必要な場合は再発行してください。';
      } else {
        badge.textContent = '共有停止中';
        badge.className = 'limited-share-badge is-off';
        detail.textContent = '現在、有効な共有リンクはありません。';
      }
      return data;
    }

    actions.append(rotate, revoke);

    rotate.addEventListener('click', async () => {
      rotate.disabled = true;
      revoke.disabled = true;
      detail.textContent = '共有リンクを発行しています...';
      try {
        const result = await client.rpc('novelight_rotate_share_link', {
          p_novel_id: Number(novelId)
        });
        if (result.error) throw result.error;
        const token = normalizeToken(result.data?.token);
        const shareUrl = buildShareUrl(token);
        if (!shareUrl) throw new Error('Share token was not returned');
        urlInput.value = shareUrl;
        fresh.hidden = false;
        await loadStatus();
      } catch (error) {
        console.error('limited share rotate failed', error);
        if (isMissingRpc(error)) {
          detail.textContent = 'データベース反映待ちです。';
        } else {
          detail.textContent = '共有リンクを発行できませんでした。';
        }
      } finally {
        rotate.disabled = false;
        revoke.disabled = false;
      }
    });

    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      rotate.disabled = true;
      detail.textContent = '共有を停止しています...';
      try {
        const result = await client.rpc('novelight_revoke_share_link', {
          p_novel_id: Number(novelId)
        });
        if (result.error) throw result.error;
        fresh.hidden = true;
        urlInput.value = '';
        await loadStatus();
      } catch (error) {
        console.error('limited share revoke failed', error);
        detail.textContent = '共有を停止できませんでした。';
      } finally {
        revoke.disabled = false;
        rotate.disabled = false;
      }
    });

    copy.addEventListener('click', async () => {
      try {
        const copied = await copyText(urlInput.value);
        if (!copied) {
          urlInput.focus();
          urlInput.select();
          detail.textContent = 'URLを選択しました。コピーしてください。';
          return;
        }
        detail.textContent = '共有URLをコピーしました。';
      } catch (error) {
        console.error('limited share copy failed', error);
        urlInput.focus();
        urlInput.select();
        detail.textContent = 'URLを選択しました。コピーしてください。';
      }
    });

    try {
      await loadStatus();
    } catch (error) {
      console.error('limited share status failed', error);
      badge.textContent = '確認失敗';
      badge.className = 'limited-share-badge is-off';
      detail.textContent = '共有状態を確認できませんでした。';
      rotate.disabled = true;
      revoke.hidden = true;
    }
  }

  async function mountReader({ client, token, episodeNumber, mount }) {
    const host = mount || document.querySelector('[data-limited-share-reader]');
    if (!host) return;

    host.replaceChildren();
    const normalized = normalizeToken(token);
    if (!normalized) {
      host.append(
        createElement(
          'div',
          'limited-share-error',
          '共有リンクが正しくありません。作者から届いたURLをもう一度確認してください。'
        )
      );
      return;
    }

    let novelResult;
    try {
      novelResult = await client.rpc('novelight_shared_novel', {
        p_token: normalized
      });
      if (novelResult.error) throw novelResult.error;
    } catch (error) {
      console.error('shared novel load failed', error);
      host.append(
        createElement(
          'div',
          'limited-share-error',
          isMissingRpc(error)
            ? '限定共有機能はデータベース反映待ちです。'
            : '共有作品を読み込めませんでした。'
        )
      );
      return;
    }

    const novel = novelResult.data;
    if (!novel) {
      host.append(
        createElement(
          'div',
          'limited-share-error',
          'この共有リンクは無効・停止済み、または作品がすでに公開されています。'
        )
      );
      return;
    }

    const shell = createElement('article', 'limited-share-reader-card');
    const eyebrow = createElement('div', 'limited-share-reader-eyebrow', '限定共有・下書き確認');
    const title = createElement('h1', 'limited-share-reader-title', novel.title || '無題');
    const meta = createElement('div', 'limited-share-reader-meta');
    if (novel.author_name) meta.append(createElement('span', '', `作者: ${novel.author_name}`));
    if (novel.genre) meta.append(createElement('span', '', novel.genre));
    const neutral = createElement(
      'p',
      'limited-share-reader-neutral',
      'この閲覧は通常公開ではなく、PV・お気に入り・LIGHT SEED・SCOUT・Rank・検索・発掘棚・露出には反映されません。'
    );
    shell.append(eyebrow, title, meta, neutral);

    if (novel.content_rating === 'mature') {
      const warning = createElement('div', 'limited-share-reader-warning');
      warning.append(
        createElement('strong', '', '内容に関する注意'),
        createElement(
          'p',
          '',
          'この作品には成熟したテーマまたは強い表現が含まれます。'
        )
      );
      const warnings = Array.isArray(novel.content_warnings)
        ? novel.content_warnings.filter(Boolean)
        : [];
      if (warnings.length) {
        const list = createElement('ul');
        warnings.forEach((item) => list.append(createElement('li', '', item)));
        warning.append(list);
      }
      shell.append(warning);
    }

    if (episodeNumber !== null && episodeNumber !== undefined) {
      const result = await client.rpc('novelight_shared_episode', {
        p_token: normalized,
        p_episode_number: Number(episodeNumber)
      });
      if (result.error) {
        shell.append(
          createElement('div', 'limited-share-error', 'エピソードを読み込めませんでした。')
        );
        host.append(shell);
        return;
      }

      const episode = result.data;
      if (!episode) {
        shell.append(
          createElement('div', 'limited-share-error', 'このエピソードは共有対象にありません。')
        );
        host.append(shell);
        return;
      }

      const back = createElement('a', 'limited-share-back', '← 共有作品の目次へ');
      back.href = buildReaderHash(normalized);
      const number = createElement(
        'div',
        'limited-share-episode-number',
        `第${episode.episode_number}話`
      );
      const episodeTitle = createElement(
        'h2',
        'limited-share-episode-title',
        episode.title || `第${episode.episode_number}話`
      );
      const content = createElement(
        'div',
        'limited-share-episode-content nl-preview-content',
        episode.content || ''
      );
      if (globalThis.NovelightProse?.renderInto) {
        globalThis.NovelightProse.renderInto(content, episode.content || '');
      }
      const nav = createElement('nav', 'limited-share-reader-nav');
      if (episode.previous_episode_number) {
        const previous = createElement('a', '', '← 前の話');
        previous.href = buildReaderHash(
          normalized,
          episode.previous_episode_number
        );
        nav.append(previous);
      }
      if (episode.next_episode_number) {
        const next = createElement('a', '', '次の話 →');
        next.href = buildReaderHash(normalized, episode.next_episode_number);
        nav.append(next);
      }
      shell.append(back, number, episodeTitle, content, nav);
    } else {
      if (novel.description) {
        shell.append(
          createElement('p', 'limited-share-reader-description', novel.description)
        );
      }
      const heading = createElement('h2', 'limited-share-toc-title', '共有中のエピソード');
      const list = createElement('div', 'limited-share-toc');
      const episodes = Array.isArray(novel.episodes) ? novel.episodes : [];
      if (!episodes.length) {
        list.append(
          createElement('p', 'limited-share-empty', '共有できるエピソードはまだありません。')
        );
      } else {
        episodes.forEach((episode) => {
          const link = createElement(
            'a',
            'limited-share-toc-link',
            `第${episode.episode_number}話　${episode.title || ''}`
          );
          link.href = buildReaderHash(normalized, episode.episode_number);
          list.append(link);
        });
      }
      shell.append(heading, list);
    }

    host.append(shell);
  }

  globalThis.NovelightLimitedShare = Object.freeze({
    buildShareUrl,
    normalizeToken,
    mountManager,
    mountReader
  });
})();
