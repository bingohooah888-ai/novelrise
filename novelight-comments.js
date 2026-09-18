(function attachNovelightComments(global) {
  'use strict';

  const MAX_COMMENT_LENGTH = 2000;
  const FEED_LIMIT = 50;
  const MODERATION_REASON_LABELS = Object.freeze({
    spoiler: 'ネタバレ',
    harassment: '嫌がらせ・攻撃的内容',
    privacy: '個人情報',
    off_topic: '作品と無関係',
    other: 'その他'
  });

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function isMissingReceptionRpc(error) {
    const message = String(error?.message || '');
    return (
      error?.code === '42883' ||
      error?.code === 'PGRST202' ||
      message.includes('does not exist') ||
      message.includes('Could not find the function')
    );
  }

  function friendlyError(error, fallback) {
    const message = String(error?.message || '');
    if (message.includes('2000文字'))
      return 'コメントは2,000文字以内で入力してください。';
    if (message.includes('COMMENTS_DISABLED')) {
      return 'この作品では現在コメントを受け付けていません。';
    }
    if (message.includes('DIRECT_INTERACTION_UNAVAILABLE')) {
      return 'この作者へのコメントは現在送信できません。';
    }
    if (
      message.includes('Author moderation unavailable') ||
      message.includes('Author reply unavailable')
    ) {
      return 'このコメントを作者として操作できません。';
    }
    if (message.includes('visible active comments')) {
      return '公開中のコメントだけ操作できます。';
    }
    if (message.includes('valid moderation reason')) {
      return '非表示理由を選択してください。';
    }
    if (message.includes('2000 characters')) {
      return '作者返信は2,000文字以内で入力してください。';
    }
    if (
      error?.code === '42501' ||
      message.includes('Authentication required')
    ) {
      return 'コメントするにはログインが必要です。';
    }
    return fallback;
  }

  async function loadReceptionState(client, novelId) {
    try {
      const result = await client.rpc(
        'novelight_novel_comment_reception_state',
        {
          p_novel_id: Number(novelId)
        }
      );
      if (result.error) throw result.error;
      return {
        commentsEnabled: result.data?.comments_enabled !== false,
        unavailable: false
      };
    } catch (error) {
      if (isMissingReceptionRpc(error)) {
        return { commentsEnabled: true, unavailable: false, fallback: true };
      }
      console.error('comment reception state unavailable', error);
      return { commentsEnabled: false, unavailable: true, fallback: false };
    }
  }

  function promptModerationReason() {
    const value = global.prompt(
      '非表示理由を選んで番号を入力してください。\n1: ネタバレ\n2: 嫌がらせ・攻撃的内容\n3: 個人情報\n4: 作品と無関係\n5: その他',
      '1'
    );
    if (value === null) return null;
    return (
      {
        1: 'spoiler',
        2: 'harassment',
        3: 'privacy',
        4: 'off_topic',
        5: 'other'
      }[String(value).trim()] || null
    );
  }

  async function runModerationAction(
    state,
    button,
    pendingText,
    rpc,
    params,
    successText
  ) {
    button.disabled = true;
    state.status.textContent = pendingText;
    try {
      const result = await state.client.rpc(rpc, params);
      if (result.error) throw result.error;
      state.status.textContent = successText;
      await refresh(state);
    } catch (error) {
      console.error('comment moderation failed', error);
      state.status.textContent = friendlyError(
        error,
        'コメント操作を完了できませんでした。時間をおいて再度お試しください。'
      );
    } finally {
      button.disabled = false;
    }
  }

  function appendAuthorModerationActions(state, comment, actions) {
    if (comment.can_moderate !== true) return;

    const pin = createElement(
      'button',
      'novelight-comment-moderation',
      comment.is_pinned === true ? '固定を解除' : '固定'
    );
    pin.type = 'button';
    pin.addEventListener('click', () =>
      runModerationAction(
        state,
        pin,
        '固定状態を変更しています...',
        'novelight_set_comment_pin',
        {
          p_comment_id: String(comment.id),
          p_pinned: comment.is_pinned !== true
        },
        comment.is_pinned === true
          ? '固定を解除しました。'
          : 'コメントを固定しました。'
      )
    );

    const hidden = createElement(
      'button',
      'novelight-comment-moderation',
      comment.is_hidden === true ? '再表示' : '非表示'
    );
    hidden.type = 'button';
    hidden.addEventListener('click', async () => {
      let reason = null;
      if (comment.is_hidden !== true) {
        reason = promptModerationReason();
        if (!reason) {
          state.status.textContent = '非表示操作をキャンセルしました。';
          return;
        }
        if (
          !global.confirm(
            'このコメントを公開欄から非表示にしますか？元コメントとSCOUT履歴は削除されません。'
          )
        ) {
          return;
        }
      }
      await runModerationAction(
        state,
        hidden,
        '表示状態を変更しています...',
        'novelight_set_comment_hidden',
        {
          p_comment_id: String(comment.id),
          p_hidden: comment.is_hidden !== true,
          p_reason: reason
        },
        comment.is_hidden === true
          ? 'コメントを再表示しました。'
          : 'コメントを公開欄から非表示にしました。'
      );
    });

    const reply = createElement(
      'button',
      'novelight-comment-moderation',
      comment.author_reply_body ? '作者返信を編集' : '作者返信'
    );
    reply.type = 'button';
    reply.addEventListener('click', async () => {
      if (comment.is_hidden === true && comment.author_reply_body) {
        if (!global.confirm('非表示中のコメントから作者返信も削除しますか？'))
          return;
        await runModerationAction(
          state,
          reply,
          '作者返信を削除しています...',
          'novelight_set_comment_author_reply',
          { p_comment_id: String(comment.id), p_body: null },
          '作者返信を削除しました。'
        );
        return;
      }
      if (comment.is_hidden === true) {
        state.status.textContent = '非表示中のコメントには返信できません。';
        return;
      }

      const value = global.prompt(
        '作者として返信を入力してください。空欄で保存すると既存返信を削除します。',
        comment.author_reply_body || ''
      );
      if (value === null) return;
      if (value.trim().length > MAX_COMMENT_LENGTH) {
        state.status.textContent =
          '作者返信は2,000文字以内で入力してください。';
        return;
      }
      if (!value.trim() && !comment.author_reply_body) {
        state.status.textContent = '作者返信を入力してください。';
        return;
      }

      await runModerationAction(
        state,
        reply,
        '作者返信を保存しています...',
        'novelight_set_comment_author_reply',
        {
          p_comment_id: String(comment.id),
          p_body: value
        },
        value.trim() ? '作者返信を保存しました。' : '作者返信を削除しました。'
      );
    });

    actions.append(pin, hidden, reply);
  }

  function renderFeed(state, comments) {
    state.list.replaceChildren();
    state.count.textContent = `${comments.length}件`;

    if (!comments.length) {
      state.list.append(
        createElement(
          'p',
          'novelight-comments-empty',
          'まだコメントはありません。最初の感想を届けてみませんか。'
        )
      );
      return;
    }

    for (const comment of comments) {
      const item = createElement(
        'article',
        `novelight-comment${comment.is_hidden === true ? ' is-hidden' : ''}`
      );
      const header = createElement('div', 'novelight-comment-header');
      const identity = createElement('div', 'novelight-comment-identity');
      const author = createElement(
        'a',
        'novelight-comment-author',
        comment.display_name || '読者'
      );
      author.href = `author.html?id=${encodeURIComponent(String(comment.user_id || ''))}`;
      identity.append(author);
      if (comment.is_pinned === true) {
        identity.append(
          createElement('span', 'novelight-comment-badge', '作者固定')
        );
      }
      if (comment.is_hidden === true) {
        identity.append(
          createElement('span', 'novelight-comment-badge is-hidden', '非表示')
        );
      }

      const time = createElement(
        'time',
        'novelight-comment-time',
        formatDate(comment.created_at)
      );
      if (comment.created_at) time.dateTime = String(comment.created_at);
      header.append(identity, time);

      const body = createElement(
        'p',
        'novelight-comment-body',
        comment.body || ''
      );
      item.append(header);
      if (comment.is_hidden === true) {
        const reason =
          state.isAuthor && comment.hidden_reason
            ? `（理由: ${MODERATION_REASON_LABELS[comment.hidden_reason] || 'その他'}）`
            : '';
        item.append(
          createElement(
            'p',
            'novelight-comment-hidden-note',
            `このコメントは作者により公開欄から非表示です。${reason}`
          )
        );
      }
      item.append(body);

      if (comment.author_reply_body) {
        const reply = createElement('div', 'novelight-comment-author-reply');
        const replyHead = createElement(
          'div',
          'novelight-comment-author-reply-head'
        );
        replyHead.append(
          createElement('strong', '', '作者からの返信'),
          createElement(
            'time',
            '',
            formatDate(
              comment.author_reply_updated_at || comment.author_reply_at
            )
          )
        );
        reply.append(
          replyHead,
          createElement(
            'p',
            'novelight-comment-author-reply-body',
            comment.author_reply_body
          )
        );
        item.append(reply);
      }

      if (comment.can_delete === true || comment.can_moderate === true) {
        const actions = createElement('div', 'novelight-comment-actions');
        if (comment.can_delete === true) {
          const button = createElement(
            'button',
            'novelight-comment-delete',
            '削除'
          );
          button.type = 'button';
          button.addEventListener('click', async () => {
            if (!global.confirm('このコメントを削除しますか？')) return;
            button.disabled = true;
            state.status.textContent = 'コメントを削除しています...';
            try {
              const result = await state.client.rpc('delete_novel_comment', {
                p_comment_id: String(comment.id)
              });
              if (result.error) throw result.error;
              state.status.textContent = 'コメントを削除しました。';
              await refresh(state);
            } catch (error) {
              console.error('comment delete failed', error);
              state.status.textContent = friendlyError(
                error,
                'コメントを削除できませんでした。時間をおいて再度お試しください。'
              );
            } finally {
              button.disabled = false;
            }
          });
          actions.append(button);
        }
        appendAuthorModerationActions(state, comment, actions);
        item.append(actions);
      }

      state.list.append(item);
    }
  }

  async function refresh(state) {
    state.list.setAttribute('aria-busy', 'true');
    try {
      const result = await state.client.rpc('novelight_comment_feed', {
        p_novel_id: String(state.novelId),
        p_limit: FEED_LIMIT
      });
      if (result.error) throw result.error;
      renderFeed(state, Array.isArray(result.data) ? result.data : []);
    } catch (error) {
      console.error('comment feed failed', error);
      state.count.textContent = '';
      state.list.replaceChildren(
        createElement(
          'p',
          'novelight-comments-error',
          'コメントを読み込めませんでした。時間をおいて再度お試しください。'
        )
      );
    } finally {
      state.list.removeAttribute('aria-busy');
    }
  }

  function renderComposer(state, session, isAuthor, reception) {
    if (reception?.unavailable) {
      state.section.append(
        createElement(
          'p',
          'novelight-comments-notice',
          'コメント受付状態を確認できないため、現在投稿できません。過去のコメントは閲覧できます。'
        )
      );
      return;
    }

    if (reception?.commentsEnabled === false) {
      state.section.append(
        createElement(
          'p',
          'novelight-comments-notice',
          isAuthor
            ? 'この作品はコメント受付を停止中です。過去のコメントは引き続き確認できます。'
            : 'この作品では現在コメントを受け付けていません。過去のコメントは閲覧できます。'
        )
      );
      return;
    }

    if (!session) {
      const notice = createElement('p', 'novelight-comments-notice');
      notice.append('コメントするには ');
      const link = createElement('a', '', 'ログイン');
      link.href = 'login.html';
      notice.append(link, ' が必要です。');
      state.section.append(notice);
      return;
    }

    if (isAuthor) {
      state.section.append(
        createElement(
          'p',
          'novelight-comments-notice',
          '作者として閲覧中です。読者から届いたコメントを確認できます。'
        )
      );
      return;
    }

    const form = createElement('form', 'novelight-comments-form');
    const label = createElement(
      'label',
      'novelight-comments-label',
      '作品へのコメント'
    );
    label.htmlFor = 'novelight-comment-body';
    const textarea = createElement('textarea', 'novelight-comments-textarea');
    textarea.id = 'novelight-comment-body';
    textarea.name = 'comment';
    textarea.maxLength = MAX_COMMENT_LENGTH;
    textarea.rows = 5;
    textarea.placeholder = '作品を読んで感じたことを作者へ届けましょう。';

    const footer = createElement('div', 'novelight-comments-form-footer');
    const counter = createElement(
      'span',
      'novelight-comments-counter',
      `0 / ${MAX_COMMENT_LENGTH.toLocaleString('ja-JP')}`
    );
    const submit = createElement(
      'button',
      'novelight-comments-submit',
      'コメントする'
    );
    submit.type = 'submit';
    footer.append(counter, submit);

    textarea.addEventListener('input', () => {
      counter.textContent = `${textarea.value.length.toLocaleString('ja-JP')} / ${MAX_COMMENT_LENGTH.toLocaleString('ja-JP')}`;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body) {
        state.status.textContent = 'コメントを入力してください。';
        textarea.focus();
        return;
      }
      if (body.length > MAX_COMMENT_LENGTH) {
        state.status.textContent =
          'コメントは2,000文字以内で入力してください。';
        return;
      }

      submit.disabled = true;
      textarea.disabled = true;
      state.status.textContent = 'コメントを送信しています...';
      try {
        const result = await state.client.rpc('post_novel_comment', {
          p_novel_id: String(state.novelId),
          p_body: body
        });
        if (result.error) throw result.error;
        textarea.value = '';
        counter.textContent = `0 / ${MAX_COMMENT_LENGTH.toLocaleString('ja-JP')}`;
        state.status.textContent = 'コメントを投稿しました。';
        await refresh(state);
      } catch (error) {
        console.error('comment post failed', error);
        state.status.textContent = friendlyError(
          error,
          'コメントを投稿できませんでした。時間をおいて再度お試しください。'
        );
      } finally {
        submit.disabled = false;
        textarea.disabled = false;
      }
    });

    form.append(label, textarea, footer);
    state.section.append(form);
  }

  async function mount({ client, novel, session, isAuthor }) {
    const card = document.getElementById('card');
    if (!card || !client || !novel?.id) return;

    document.getElementById('novelight-comments')?.remove();

    const section = createElement('section', 'novelight-comments');
    section.id = 'novelight-comments';
    section.setAttribute('aria-labelledby', 'novelight-comments-title');

    const headingRow = createElement('div', 'novelight-comments-heading');
    const title = createElement('h2', '', 'コメント');
    title.id = 'novelight-comments-title';
    const count = createElement('span', 'novelight-comments-count', '');
    headingRow.append(title, count);
    section.append(headingRow);

    const status = createElement('div', 'novelight-comments-status', '');
    status.setAttribute('aria-live', 'polite');
    const list = createElement('div', 'novelight-comments-list');
    section.append(status, list);

    const state = {
      client,
      novelId: novel.id,
      section,
      count,
      status,
      list,
      isAuthor: isAuthor === true
    };
    const reception = await loadReceptionState(client, novel.id);
    renderComposer(state, session, isAuthor, reception);
    card.append(section);
    await refresh(state);
  }

  global.NovelightComments = Object.freeze({ mount });
})(window);
