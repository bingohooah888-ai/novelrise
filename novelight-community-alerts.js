/* Community reaction notices, separate from author-follow update notifications. */
(() => {
  if (window.NOVELIGHT_COMMUNITY_FLAGS?.timeline !== true) return;
  const target = document.getElementById('communityNotifications');
  if (!target || !window.supabase) return;
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co','sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  const item = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  void (async () => {
    try {
      const auth = await client.auth.getSession();
      if (auth.error || !auth.data.session?.user) return;
      const {data,error} = await client.rpc('novelight_community_my_notifications',{p_limit:40});
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) return;

      const title = item('h2','あなたへの交流');
      const summary = item('span','', 'community-notice-count');
      summary.setAttribute('role','status');
      const allRead = item('button','表示中をすべて既読にする','community-notice-all-read');
      allRead.type = 'button';
      const toolbar = item('div',undefined,'community-notice-toolbar');
      const unreadOnly = item('button','未読のみ表示','community-notice-filter');
      unreadOnly.type = 'button';
      unreadOnly.setAttribute('aria-pressed','false');
      toolbar.append(summary,unreadOnly,allRead);
      const list = item('ul',undefined,'community-notice-list');
      const feedback = item('p',undefined,'community-notice-feedback');
      feedback.setAttribute('role','status');
      feedback.hidden = true;
      let pending = false;
      let showingUnreadOnly = false;
      const unread = new Map();
      function syncFilter() {
        for (const row of list.children) {
          row.hidden = showingUnreadOnly && !row.classList.contains('community-notice-unread');
        }
      }
      unreadOnly.addEventListener('click', () => {
        showingUnreadOnly = !showingUnreadOnly;
        unreadOnly.setAttribute('aria-pressed',String(showingUnreadOnly));
        unreadOnly.textContent = showingUnreadOnly ? 'すべて表示' : '未読のみ表示';
        syncFilter();
      });
      function updateCount() {
        const remaining = unread.size;
        summary.textContent = remaining
          ? '最新40件中、未読 ' + remaining + '件'
          : '表示中の通知は確認済みです';
        allRead.hidden = remaining === 0;
        syncFilter();
      }

      async function markRead(ids) {
        if (pending || !ids.length) return;
        pending = true;
        allRead.disabled = true;
        for (const notice of unread.values()) notice.button.disabled = true;
        feedback.hidden = true;
        try {
          const result = await client.rpc('novelight_community_mark_notifications_read',{p_ids:ids});
          if (result.error) throw result.error;
          if (!Number.isSafeInteger(result.data) || result.data < 0 || result.data > ids.length) {
            throw new Error('Invalid read receipt');
          }
          for (const id of ids) {
            const notice = unread.get(id);
            if (!notice) continue;
            notice.row.classList.replace('community-notice-unread','community-notice-read');
            notice.button.hidden = true;
            unread.delete(id);
          }
          updateCount();
        } catch (error) {
          console.warn('community notifications read acknowledgement failed',error);
          feedback.textContent = '既読にできませんでした。もう一度お試しください。';
          feedback.hidden = false;
        } finally {
          pending = false;
          allRead.disabled = false;
          for (const notice of unread.values()) notice.button.disabled = false;
        }
      }

      for (const notice of data) {
        const key = String(notice.post_key || '');
        if (!/^(?:novel:[0-9]+|note:[0-9]+|curation:[0-9]+|seed:[0-9a-f-]{36}|official:[0-9]+|ep:[0-9a-f-]{36}:[0-9]+:[0-9]+)$/i.test(key)) continue;
        const id = Number(notice.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const hasRead = Boolean(notice.read_at);
        const li = item('li',undefined,hasRead?'community-notice-read':'community-notice-unread');
        const label = notice.kind === 'like' ? 'いいね' : notice.kind === 'reply' ? '返信' : 'コメント';
        li.append(item('span',(notice.actor_name || 'ユーザー') + 'さんから' + label + 'が届きました'));
        const commentId = String(notice.comment_id || '');
        const focusComment = (notice.kind === 'reply' || notice.kind === 'comment') &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commentId);
        const link = item('a',focusComment ? 'コメントを見る' : '投稿を確認');
        link.href = 'community.html' +
          (focusComment ? '?comment=' + encodeURIComponent(commentId) : '') +
          '#post-' + encodeURIComponent(key);
        if (!hasRead) {
          // Read acknowledgement precedes navigation, but never prevents
          // visiting the post if the network is slow or unavailable.
          link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey ||
                event.shiftKey || event.altKey || event.defaultPrevented) return;
            event.preventDefault();
            let navigated = false;
            const navigate = () => {
              if (navigated) return;
              navigated = true;
              window.location.assign(link.href);
            };
            const timeout = window.setTimeout(navigate, 1500);
            void markRead([id]).finally(() => {
              window.clearTimeout(timeout);
              navigate();
            });
          });
        }
        li.append(link);
        if (!hasRead && !unread.has(id)) {
          const button = item('button','既読にする','community-notice-mark');
          button.type = 'button';
          button.addEventListener('click',() => { void markRead([id]); });
          li.append(button);
          unread.set(id,{row:li,button});
        }
        list.append(li);
      }
      if (!list.children.length) return;
      allRead.addEventListener('click',() => { void markRead([...unread.keys()]); });
      updateCount();
      target.append(title,toolbar,list,feedback);
      target.hidden = false;
    } catch(err) {
      console.warn('community notifications unavailable',err);
    }
  })();
})();
