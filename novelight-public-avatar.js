/* Shared public-profile image renderer. No direct profiles table reads.
   All paths come from approved read-only RPCs and must belong to the author. */
(() => {
  'use strict';
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const userIdPattern = new RegExp('^' + uuid + '$', 'i');
  const ownedPathPattern = new RegExp('^(' + uuid + ')/(' + uuid + ')\\.(webp|png|jpg|jpeg)$', 'i');


  // Public Production Storage origin. No client private fields or SDK
  // Storage methods are needed to render an already approved public path.
  const productionHosts = new Set([
    'novelight.jp',
    'www.novelight.jp',
    'novelrise.vercel.app'
  ]);
  const productionStorageOrigin = 'https://fiepaguycecrredwrcwx.supabase.co';

  function getPublicAvatarUrl(storedPath, client) {
    const encodedPath = storedPath.split('/').map(encodeURIComponent).join('/');
    const hostname = window.location?.hostname?.toLowerCase() || '';
    if (productionHosts.has(hostname)) {
      return productionStorageOrigin +
        '/storage/v1/object/public/author-avatars/' + encodedPath;
    }

    // Non-production environments must use their own validated API origin.
    let origin = '';
    try {
      const parsed = new URL(String(client?.supabaseUrl || ''));
      if (
        parsed.protocol === 'https:' &&
        /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.pathname === '/'
      ) {
        origin = parsed.origin;
      }
    } catch {
      return null;
    }
    if (!origin) return null;
    return origin + '/storage/v1/object/public/author-avatars/' + encodedPath;
  }

  function paint(holder, path, authorId, displayName, client) {
    if (!holder) return;
    const fallback = String(displayName || '作').trim().slice(0, 1) || '作';
    holder.replaceChildren(fallback);
    holder.removeAttribute('data-avatar-path');
    const owner = String(authorId || '').toLowerCase();
    const storedPath = String(path || '');
    const match = storedPath.match(ownedPathPattern);
    if (!userIdPattern.test(owner) || !match || match[1].toLowerCase() !== owner) return;

    const url = getPublicAvatarUrl(storedPath, client);
    if (!url) {
      holder.dataset.avatarStatus = 'url-unavailable';
      return;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    holder.dataset.avatarPath = storedPath;
    holder.dataset.avatarStatus = 'loading';
    image.onload = () => {
      if (holder.isConnected && holder.dataset.avatarPath === storedPath) {
        holder.replaceChildren(image);
        holder.dataset.avatarStatus = 'loaded';
      }
    };
    image.onerror = () => {
      if (holder.dataset.avatarPath === storedPath) {
        holder.replaceChildren(fallback);
        holder.dataset.avatarStatus = 'load-error';
      }
    };
    holder.append(image);
    image.src = url;
  }

  window.NovelightPublicAvatar = Object.freeze({ paint });
})();
