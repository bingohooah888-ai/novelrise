(() => {
  'use strict';

  const CANONICAL_ORIGIN = 'https://novelight.jp';
  const SHARE_CAMPAIGN = 'novelight_work_share';
  const TARGET_PAGES = new Set(['my-novels', 'novel', 'episode']);

  function currentPageSlug() {
    return (window.location.pathname.split('/').pop() || 'index.html')
      .replace(/\.html$/u, '')
      .replace(/[^a-z0-9-]/giu, '-')
      .toLowerCase();
  }

  if (!TARGET_PAGES.has(currentPageSlug())) return;

  function canonicalUrl(page, id) {
    const url = new URL(page, `${CANONICAL_ORIGIN}/`);
    url.searchParams.set('id', String(id));
    return url.toString();
  }

  function attributedShareUrl(url, novelId, source, medium) {
    const tracked = new URL(url);
    tracked.searchParams.set('utm_source', source);
    tracked.searchParams.set('utm_medium', medium);
    tracked.searchParams.set('utm_campaign', SHARE_CAMPAIGN);
    tracked.searchParams.set('utm_content', `novel:${String(novelId)}`);
    return tracked.toString();
  }

  function installStyles() {
    if (document.getElementById('novelight-public-share-style')) return;
    const style = document.createElement('style');
    style.id = 'novelight-public-share-style';
    style.textContent =
      '.novelight-public-share{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 0;padding:12px;border:1px solid #e2e0ea;border-radius:12px;background:#faf9ff}' +
      '.novelight-public-share-label{margin-right:2px;color:#5d566d;font-size:12px;font-weight:900}' +
      '.novelight-public-share-action{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:8px 12px;border:1px solid #cbc5e8;border-radius:8px;background:#fff;color:#443875;font:inherit;font-size:12px;font-weight:900;line-height:1.2;text-decoration:none;cursor:pointer}' +
      '.novelight-public-share-action:hover{border-color:#9b89e8;background:#f5f2ff;color:#443875}' +
      '.novelight-public-share-action:focus-visible{outline:3px solid rgba(109,74,255,.35);outline-offset:2px}' +
      '.novelight-public-share-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
      '.novelight-public-share.episode-share{margin:18px 0}' +
      "body[data-reading-theme='dark'] .novelight-public-share{border-color:#464057;background:#292633}" +
      "body[data-reading-theme='dark'] .novelight-public-share-label{color:#d8d2e6}" +
      "body[data-reading-theme='dark'] .novelight-public-share-action{border-color:#5e5674;background:#353141;color:#f0ecff}" +
      "body[data-reading-theme='dark'] .novelight-public-share-action:hover{border-color:#8275a1;background:#403a50;color:#fff}" +
      '@media(max-width:600px){.novelight-public-share{align-items:stretch}.novelight-public-share-label{flex:1 1 100%}.novelight-public-share-action{flex:1 1 calc(50% - 8px)}.novelight-public-share-action.open{flex-basis:100%}}';
    document.head.appendChild(style);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy command was rejected.');
  }

  async function copyUrl(url) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return;
    }
    fallbackCopy(url);
  }

  function temporaryLabel(button, text, duration = 1400) {
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = text;
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, duration);
  }

  function shareBar({
    url,
    novelId,
    text,
    label,
    includeOpen = false,
    position = 'default'
  }) {
    const bar = document.createElement('div');
    bar.className = 'novelight-public-share';
    if (position.startsWith('episode-')) bar.classList.add('episode-share');
    bar.dataset.novelightPublicShare = position;

    const heading = document.createElement('span');
    heading.className = 'novelight-public-share-label';
    heading.textContent = label;
    bar.appendChild(heading);

    if (includeOpen) {
      const open = document.createElement('a');
      open.className = 'novelight-public-share-action open';
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = '公開ページを見る';
      bar.appendChild(open);
    }

    const status = document.createElement('span');
    status.className = 'novelight-public-share-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const copyShareUrl = attributedShareUrl(
      url,
      novelId,
      'novelight',
      'share'
    );
    const xShareUrl = attributedShareUrl(url, novelId, 'x', 'social');

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'novelight-public-share-action copy';
    copy.textContent = 'URLをコピー';
    copy.addEventListener('click', async () => {
      try {
        await copyUrl(copyShareUrl);
        temporaryLabel(copy, 'コピーしました');
        status.textContent = '共有用URLをコピーしました。';
      } catch (error) {
        console.error('public share URL copy failed', error);
        temporaryLabel(copy, 'コピーできませんでした', 1800);
        status.textContent =
          'URLをコピーできませんでした。ブラウザの設定をご確認ください。';
      }
    });
    bar.appendChild(copy);

    const shareX = document.createElement('button');
    shareX.type = 'button';
    shareX.className = 'novelight-public-share-action x';
    shareX.textContent = 'Xでシェア';
    shareX.addEventListener('click', () => {
      const intent = new URL('https://twitter.com/intent/tweet');
      intent.searchParams.set('text', text);
      intent.searchParams.set('url', xShareUrl);
      const popup = window.open(
        intent.toString(),
        '_blank',
        'noopener,noreferrer'
      );
      if (popup) popup.opener = null;
    });
    bar.appendChild(shareX);
    bar.appendChild(status);

    return bar;
  }

  function idFromLink(link) {
    if (!link) return null;
    try {
      return new URL(
        link.getAttribute('href') || '',
        window.location.href
      ).searchParams.get('id');
    } catch {
      return null;
    }
  }

  function installMyNovelsSharing() {
    if (currentPageSlug() !== 'my-novels') return false;
    const list = document.getElementById('list');
    if (!list) return false;

    const mount = () => {
      list.querySelectorAll('.card').forEach((card) => {
        if (card.querySelector('[data-novelight-public-share]')) return;
        const state = card.querySelector('.state');
        if (!state || !state.textContent.includes('公開中')) return;

        const titleLink = card.querySelector('.title[href*="novel.html"]');
        const novelId = idFromLink(titleLink);
        const actions = card.querySelector('.work-actions');
        if (!titleLink || !novelId || !actions) return;

        const title = titleLink.textContent.trim() || '作品';
        actions.before(
          shareBar({
            url: canonicalUrl('novel.html', novelId),
            novelId,
            text: `『${title}』をNOVELIGHTで読む`,
            label: '作品を共有',
            includeOpen: true,
            position: 'work-card'
          })
        );
      });
    };

    mount();
    new MutationObserver(mount).observe(list, {
      childList: true,
      subtree: true
    });
    return true;
  }

  function installNovelSharing() {
    if (currentPageSlug() !== 'novel') return false;
    const header = document.getElementById('novelHeader');
    const novelId = new URLSearchParams(window.location.search).get('id');
    if (!header || !novelId) return false;

    const mount = () => {
      if (header.querySelector('[data-novelight-public-share]')) return;
      const titleNode = header.querySelector('.title');
      if (!titleNode) return;
      const title = titleNode.textContent.trim() || '作品';
      header.appendChild(
        shareBar({
          url: canonicalUrl('novel.html', novelId),
          novelId,
          text: `『${title}』をNOVELIGHTで読む`,
          label: 'この作品を共有',
          position: 'novel'
        })
      );
    };

    mount();
    new MutationObserver(mount).observe(header, {
      childList: true,
      subtree: true
    });
    return true;
  }

  function installEpisodeSharing() {
    if (currentPageSlug() !== 'episode') return false;
    const card = document.getElementById('card');
    const episodeId = new URLSearchParams(window.location.search).get('id');
    if (!card || !episodeId) return false;

    const mount = () => {
      if (
        card.querySelector(
          '[data-novelight-public-share="episode-top"]'
        )
      ) {
        return;
      }

      const titleNode = card.querySelector('h1');
      const content = card.querySelector('.content');
      const novelLink = card.querySelector('.novel-title a');
      const novelId = idFromLink(novelLink);
      if (!titleNode || !content || !novelLink || !novelId) return;

      const episodeTitle = titleNode.textContent.trim() || 'エピソード';
      const novelTitle = novelLink.textContent.trim() || '作品';
      const url = canonicalUrl('episode.html', episodeId);
      const text = `『${novelTitle}』 ${episodeTitle}｜NOVELIGHT`;

      titleNode.after(
        shareBar({
          url,
          novelId,
          text,
          label: 'このエピソードを共有',
          position: 'episode-top'
        })
      );
      content.after(
        shareBar({
          url,
          novelId,
          text,
          label: '読了したエピソードを共有',
          position: 'episode-bottom'
        })
      );
    };

    mount();
    new MutationObserver(mount).observe(card, {
      childList: true,
      subtree: true
    });
    return true;
  }

  installStyles();
  installMyNovelsSharing();
  installNovelSharing();
  installEpisodeSharing();
})();
