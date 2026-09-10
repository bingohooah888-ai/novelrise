(function attachNovelightComments(global) {
  'use strict';

  const MAX_COMMENT_LENGTH = 2000;
  const FEED_LIMIT = 50;

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
      minute: '2-digit',
    });
  }

  function friendlyError(error, fallback) {
    const message = String(error?.message || '');
    if (message.includes('2000文字')) return 'コメントは2,000文字以内で入力してください。';
    if (error?.code === '42501' || message.includes('Authentication required')) {
      return 'コメントするにはログインが必要です。';
    }
    return fallback;
  }

  function renderFeed(state, comments) {
    state.list.replaceChildren();
    state.count.textContent = `${comments.length}件`;

    if (!comments.length) {
      state.list.append(createElement('p', 'novelight-comments-empty', 'まだコメントはありません。最初の感想を届けてみませんか。'));
      return;
    }

    for (const comment of comments) {
      const item = createElement('article', 'novelight-comment');
      const header = createElement('div', 'novelight-comment-header');
      const author = createElement('strong', 'novelight-comment-author', comment.display_name || '読者');
      const time = createElement('time', 'novelight-comment-time', formatDate(comment.created_at));
      if (comment.created_at) time.dateTime = String(comment.created_at);
      header.append(author, time);

      const body = createElement('p', 'novelight-comment-body', comment.body || '');
      item.append(header, body);

      if (comment.can_delete === true) {
        const actions = createElement('div', 'novelight-comment-actions');
        const button = createElement('button', 'novelight-comment-delete', '削除');
        button.type = 'button';
        button.addEventListener('click', async () => {
          if (!global.confirm('このコメントを削除しますか？')) return;
          button.disabled = true;
          state.status.textContent = 'コメントを削除しています...';
          try {
            const result = await state.client.rpc('delete_novel_comment', {
              p_comment_id: String(comment.id),
            });
            if (result.error) throw result.error;
            state.status.textContent = 'コメントを削除しました。';
            await refresh(state);
          } catch (error) {
            console.error('comment delete failed', error);
            state.status.textContent = friendlyError(error, 'コメントを削除できませんでした。時間をおいて再度お試しください。');
          } finally {
            button.disabled = false;
          }
        });
        actions.append(button);
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
        p_limit: FEED_LIMIT,
      });
      if (result.error) throw result.error;
      renderFeed(state, Array.isArray(result.data) ? result.data : []);
    } catch (error) {
      console.error('comment feed failed', error);
      state.count.textContent = '';
      state.list.replaceChildren(
        createElement('p', 'novelight-comments-error', 'コメントを読み込めませんでした。時間をおいて再度お試しください。'),
      );
    } finally {
      state.list.removeAttribute('aria-busy');
    }
  }

  function renderComposer(state, session, isAuthor) {
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
        createElement('p', 'novelight-comments-notice', '作者として閲覧中です。読者から届いたコメントを確認できます。'),
      );
      return;
    }

    const form = createElement('form', 'novelight-comments-form');
    const label = createElement('label', 'novelight-comments-label', '作品へのコメント');
    label.htmlFor = 'novelight-comment-body';
    const textarea = createElement('textarea', 'novelight-comments-textarea');
    textarea.id = 'novelight-comment-body';
    textarea.name = 'comment';
    textarea.maxLength = MAX_COMMENT_LENGTH;
    textarea.rows = 5;
    textarea.placeholder = '作品を読んで感じたことを作者へ届けましょう。';

    const footer = createElement('div', 'novelight-comments-form-footer');
    const counter = createElement('span', 'novelight-comments-counter', `0 / ${MAX_COMMENT_LENGTH.toLocaleString('ja-JP')}`);
    const submit = createElement('button', 'novelight-comments-submit', 'コメントする');
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
        state.status.textContent = 'コメントは2,000文字以内で入力してください。';
        return;
      }

      submit.disabled = true;
      textarea.disabled = true;
      state.status.textContent = 'コメントを送信しています...';
      try {
        const result = await state.client.rpc('post_novel_comment', {
          p_novel_id: String(state.novelId),
          p_body: body,
        });
        if (result.error) throw result.error;
        textarea.value = '';
        counter.textContent = `0 / ${MAX_COMMENT_LENGTH.toLocaleString('ja-JP')}`;
        state.status.textContent = 'コメントを投稿しました。';
        await refresh(state);
      } catch (error) {
        console.error('comment post failed', error);
        state.status.textContent = friendlyError(error, 'コメントを投稿できませんでした。時間をおいて再度お試しください。');
      } finally {
        submit.disabled = false;
        textarea.disabled = false;
      }
    });

    form.append(label, textarea, footer);
    state.section.append(form);
    state.section.append(
      createElement(
        'p',
        'novelight-comments-exp-note',
        '条件を満たすコメントはSCOUT EXPの対象になります。コメント自体が作品Rankを直接上げることはありません。',
      ),
    );
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

    const state = { client, novelId: novel.id, section, count, status, list };
    renderComposer(state, session, isAuthor);
    card.append(section);
    await refresh(state);
  }

  global.NovelightComments = Object.freeze({ mount });
})(window);
