(() => {
  'use strict';

  if (window.NovelightXImageShare) return;

  // X intent URLs cannot attach media. Use native file sharing when available;
  // otherwise copy the PNG so the reader can paste it into X's composer.
  const ORIGIN = 'https://novelight.jp';
  const SUPABASE_ORIGIN = 'https://fiepaguycecrredwrcwx.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const prepared = new Map();
  let client;

  function safeCoverUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return '';
      if (url.origin === ORIGIN) return url.href;
      if (
        url.origin === SUPABASE_ORIGIN &&
        url.pathname.startsWith('/storage/v1/object/public/')
      ) {
        return url.href;
      }
    } catch {
      // Invalid/untrusted cover URLs are never fetched.
    }
    return '';
  }

  function setClient(sharedClient) {
    if (sharedClient) client = sharedClient;
  }

  function getClient() {
    if (!client && window.supabase?.createClient) {
      client = window.supabase.createClient(SUPABASE_ORIGIN, PUBLIC_KEY);
    }
    return client;
  }

  async function coverCandidates(id) {
    const db = getClient();
    if (!db) return [];
    const urls = [];
    const add = (value) => {
      const safe = safeCoverUrl(value);
      if (safe && !urls.includes(safe)) urls.push(safe);
    };

    try {
      const result = await db
        .from('novels')
        .select('thumbnail_asset_id,thumbnail_url,status')
        .eq('id', Number(id))
        .eq('status', 'published')
        .maybeSingle();
      if (result.error || !result.data) return [];

      const novel = result.data;
      if (novel.thumbnail_asset_id) {
        const asset = await db
          .from('novel_thumbnail_assets')
          .select('image_url')
          .eq('id', novel.thumbnail_asset_id)
          .maybeSingle();
        if (!asset.error) add(asset.data?.image_url);
      }
      add(novel.thumbnail_url);

      // This is the same persisted Geometry render used by the work detail.
      if (!urls.length) {
        let composition = await db.rpc('novelight_thumbnail_compositions_v3', {
          p_novel_ids: [Number(id)]
        });
        if (composition.error) {
          composition = await db.rpc('novelight_thumbnail_compositions_v2', {
            p_novel_ids: [Number(id)]
          });
        }
        if (!composition.error) {
          const row = Array.isArray(composition.data)
            ? composition.data[0]
            : null;
          add(row?.render_url);
        }
      }
    } catch (error) {
      console.warn('X share cover lookup unavailable', error);
    }
    return urls;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function canvasPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
        'image/png'
      );
    });
  }

  async function coverPng(url) {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(8000)
    });
    const size = Number(response.headers.get('content-length') || 0);
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (
      !response.ok ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(mime) ||
      size > MAX_SOURCE_BYTES
    ) {
      throw new Error('Cover image is unavailable or unsupported');
    }
    const blob = await response.blob();
    if (blob.size > MAX_SOURCE_BYTES) throw new Error('Cover image is too large');
    const objectUrl = typeof createImageBitmap === 'function'
      ? null
      : URL.createObjectURL(blob);
    const bitmap = objectUrl
      ? await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = objectUrl;
        })
      : await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1200 / bitmap.width, 1800 / bitmap.height);
      const canvas = makeCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale))
      );
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvasPng(canvas);
    } finally {
      bitmap.close?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function defaultCoverPng() {
    // Match NOVELIGHT's existing dark-navy/gold fallback identity.
    const canvas = makeCanvas(720, 1080);
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 720, 1080);
    bg.addColorStop(0, '#071221');
    bg.addColorStop(0.55, '#10243d');
    bg.addColorStop(1, '#071221');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 720, 1080);
    ctx.strokeStyle = '#d6a447';
    ctx.lineWidth = 5;
    ctx.strokeRect(60, 60, 600, 960);
    ctx.strokeStyle = 'rgba(214,164,71,.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(80, 80, 560, 920);
    ctx.fillStyle = '#d6a447';
    ctx.textAlign = 'center';
    ctx.font = '900 270px Georgia, serif';
    ctx.fillText('N', 360, 575);
    ctx.font = 'bold 52px Georgia, serif';
    ctx.fillText('NOVELIGHT', 360, 715);
    return canvasPng(canvas);
  }

  async function loadCoverFile(novelId) {
    const urls = await coverCandidates(novelId);
    for (const url of urls) {
      try {
        const png = await coverPng(url);
        return new File([png], 'NOVELIGHT-' + novelId + '.png', {
          type: 'image/png'
        });
      } catch (error) {
        console.warn('X share cover unavailable; trying fallback', error);
      }
    }
    const fallback = await defaultCoverPng();
    return new File([fallback], 'NOVELIGHT-' + novelId + '.png', {
      type: 'image/png'
    });
  }

  function prepare(novelId) {
    const id = String(novelId || '');
    if (!/^\d+$/.test(id)) return null;
    if (!prepared.has(id)) {
      const state = { file: null, promise: null };
      state.promise = loadCoverFile(id)
        .then((file) => {
          state.file = file;
          return file;
        })
        .catch((error) => {
          prepared.delete(id);
          throw error;
        });
      prepared.set(id, state);
    }
    return prepared.get(id);
  }

  function intentUrl(title, url) {
    const intent = new URL('https://twitter.com/intent/tweet');
    intent.searchParams.set('text', '『' + String(title || '作品').slice(0, 90) + '』をNOVELIGHTで読む');
    // X may cache an older no-image card for a previously shared novel URL.
    // Use a stable revision on X shares only; readers still land on the same work.
    const shareUrl = new URL(url, ORIGIN);
    if (shareUrl.origin === ORIGIN) {
      if (shareUrl.pathname === '/novel.html') {
        shareUrl.searchParams.set('x_card', 'png-v3');
      } else if (shareUrl.pathname === '/episode.html') {
        shareUrl.searchParams.set('x_card', 'episode-png-v1');
      }
    }
    intent.searchParams.set('url', shareUrl.href);
    return intent.href;
  }

  function downloadFile(file) {
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 30000);
  }

  function isMobileShareTarget() {
    // Windows browsers can offer navigator.share(), but that opens the OS
    // sharing menu instead of the X composer. Use it only on mobile devices.
    return (
      navigator.userAgentData?.mobile === true ||
      /Android|iPhone|iPad|iPod/iu.test(navigator.userAgent || '')
    );
  }

  async function share({ novelId, title, url, onStatus = () => {} }) {
    const state = prepare(novelId);
    if (!state) return onStatus('作品IDが確認できません。');
    // A link card does not need the local PNG. Open X immediately on PC,
    // even if cover preparation is still running.
    if (!isMobileShareTarget() && !state.file) {
      window.open(intentUrl(title, url), '_blank', 'noopener,noreferrer');
      onStatus(
        'Xで作品URLを投稿すると画像付きリンクカードが表示されます（表示はX側の取得状況によります）。'
      );
      return;
    }
    if (!state.file) {
      onStatus('画像を準備しています。完了後にもう一度「Xでシェア」を押してください。');
      try {
        await state.promise;
        onStatus('画像の準備ができました。もう一度「Xでシェア」を押してください。');
      } catch {
        onStatus('画像を準備できませんでした。時間をおいて再度お試しください。');
      }
      return;
    }

    const file = state.file;
    const payload = {
      title: String(title || 'NOVELIGHTの作品'),
      text: '『' + String(title || '作品').slice(0, 90) + '』をNOVELIGHTで読む',
      url,
      files: [file]
    };
    if (
      isMobileShareTarget() &&
      typeof navigator.share === 'function' &&
      navigator.canShare?.({ files: [file] })
    ) {
      try {
        await navigator.share(payload);
        onStatus('共有アプリでXを選択すると画像付きで投稿できます。');
      } catch (error) {
        if (error?.name !== 'AbortError') {
          onStatus('画像共有が利用できませんでした。再度お試しください。');
        }
      }
      return;
    }

    // Start clipboard write while this page still has focus. Opening a new
    // tab first can make the Clipboard API reject with NotAllowedError.
    let copyResult = null;
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        copyResult = navigator.clipboard.write([
          new ClipboardItem({ 'image/png': file })
        ]);
      }
    } catch (error) {
      console.warn('X share clipboard unavailable', error);
    }
    // Still open under the original user gesture so popup blockers allow it.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    let copied = false;
    try {
      if (copyResult) {
        await copyResult;
        copied = true;
      }
    } catch (error) {
      console.warn('X share clipboard unavailable', error);
    }
    if (!copied) downloadFile(file);
    if (popup && !popup.closed) {
      popup.location.replace(intentUrl(title, url));
    } else {
      window.open(intentUrl(title, url), '_blank', 'noopener,noreferrer');
    }
    onStatus(
      copied
        ? 'Xで作品URLを投稿すると画像付きリンクカードが表示されます（表示はX側の取得状況によります）。表紙の直接添付は任意でCtrl+Vを使えます。'
        : 'Xで作品URLを投稿すると画像付きリンクカードが表示されます（表示はX側の取得状況によります）。表紙の直接添付は任意です。'
    );
  }

  window.NovelightXImageShare = Object.freeze({ prepare, share, setClient });
})();