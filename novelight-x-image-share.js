(() => {
  'use strict';

  if (window.NovelightXImageShare) return;

  // X link cards should navigate to the work or episode, not open a media
  // viewer. Use URL-only sharing on all devices, never an image attachment.
  const ORIGIN = 'https://novelight.jp';
  const SUPABASE_ORIGIN = 'https://fiepaguycecrredwrcwx.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const prepared = new Map();
  const warming = new Map();
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
      const custom = await db.from('novel_custom_covers')
        .select('storage_path').eq('novel_id', Number(id)).maybeSingle();
      const customPath = String(custom.data?.storage_path || '');
      if (!custom.error && /^[0-9a-f-]{36}\/[0-9]+\/[0-9a-f-]{36}\.(?:webp|png|jpg)$/u.test(customPath)) {
        const customUrl = db.storage.from('novel-custom-covers').getPublicUrl(customPath);
        add(customUrl.data?.publicUrl);
      }
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

  function currentCardRevision(shareUrl) {
    // The SSR Twitter image contains an immutable, content-derived card hash.
    // An updated author cover changes the hash and thus the X share URL.
    if (window.location?.pathname !== '/novel.html') return '';
    const here = new URL(window.location.href);
    if (here.searchParams.get('id') !== shareUrl.searchParams.get('id')) return '';
    const meta = document.querySelector?.('meta[name="twitter:image"]');
    const imageUrl = meta?.getAttribute?.('content') || '';
    const match = imageUrl.match(/\/social-cards\/\d+\/([0-9a-f]{16})\.png(?:\?|$)/u);
    return match ? 'png-' + match[1] : '';
  }

  function intentUrl(title, url) {
    const intent = new URL('https://twitter.com/intent/tweet');
    intent.searchParams.set('text', '『' + String(title || '作品').slice(0, 90) + '』をNOVELIGHTで読む');
    // X may cache an older no-image card for a previously shared novel URL.
    // Use a stable revision on X shares only; readers still land on the same work.
    const shareUrl = new URL(url, ORIGIN);
    if (shareUrl.origin === ORIGIN) {
      if (shareUrl.pathname === '/novel.html') {
        // This work's public PNG was updated after an older preview had
        // already circulated. Refresh only its X crawler cache identity.
        const revision =
          shareUrl.searchParams.get('id') === '257'
            ? 'png-v6-257-refresh'
            : 'png-v5-mincho';
        shareUrl.searchParams.set('x_card', currentCardRevision(shareUrl) || revision);
      } else if (shareUrl.pathname === '/episode.html') {
        shareUrl.searchParams.set('x_card', 'episode-png-v4-fast');
      }
    }
    intent.searchParams.set('url', shareUrl.href);
    return intent.href;
  }

  async function ensureXCardReady(intent) {
    const shareUrl = new URL(new URL(intent).searchParams.get('url'));
    if (shareUrl.origin !== ORIGIN) throw new Error('Untrusted share URL');

    const response = await fetch(shareUrl.href, {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Public share page is unavailable');

    const html = await response.text();
    const imageUrl = safeCoverUrl(
      html.match(/<meta name="twitter:image" content="([^"]+)">/u)?.[1]
    );
    if (!imageUrl) throw new Error('Public X image metadata is missing');

    // Image loading checks real PNG decoding without cross-origin read access.
    await new Promise((resolve, reject) => {
      const image = new Image();
      const timer = window.setTimeout(
        () => reject(new Error('Image load timeout')),
        8000
      );
      image.onload = () => {
        window.clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Public X image cannot be decoded'));
      };
      image.src = imageUrl;
    });
  }

  // Start fetching the published card while the reader is looking at the
  // share button. This warms NOVELIGHT's immutable PNG without blocking the
  // user gesture or opening a temporary, empty browser tab.
  function warm(url) {
    let publicUrl;
    try {
      publicUrl = new URL(url, ORIGIN);
      if (publicUrl.origin !== ORIGIN) return null;
    } catch {
      return null;
    }
    const key = publicUrl.href;
    if (!warming.has(key)) {
      const task = ensureXCardReady(intentUrl('', key))
        .then(() => true)
        .catch((error) => {
          warming.delete(key);
          console.warn('X share card warmup unavailable', error);
          return false;
        });
      warming.set(key, task);
    }
    return warming.get(key);
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
    if (!/^\d+$/.test(String(novelId || ''))) {
      return onStatus('作品IDが確認できません。');
    }
    // Keep the first tap synchronous on iOS, Android, and desktop.
    // Published X metadata provides the clickable 1200x630 image card.
    void warm(url);
    const intent = intentUrl(title, url);
    const popup = window.open(intent, '_blank');
    // Track opening NOVELIGHT's X composer, not whether the post was published.
    void window.NovelightClient?.recordJourney?.(getClient(), 'x_share_open', novelId);
    if (popup) popup.opener = null;
    else window.location?.assign?.(intent);
  }

  window.NovelightXImageShare = Object.freeze({ prepare, warm, share, setClient, isMobileShareTarget });
})();