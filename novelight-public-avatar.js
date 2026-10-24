/* Shared public-profile image renderer. No direct profiles table reads.
   All paths come from approved read-only RPCs and must belong to the author. */
(() => {
  'use strict';
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const userIdPattern = new RegExp('^' + uuid + '$', 'i');
  const ownedPathPattern = new RegExp('^(' + uuid + ')/(' + uuid + ')\\.(webp|png|jpg|jpeg)$', 'i');

  function paint(holder, path, authorId, displayName, client) {
    if (!holder) return;
    const fallback = String(displayName || '作').trim().slice(0, 1) || '作';
    holder.replaceChildren(fallback);
    holder.removeAttribute('data-avatar-path');
    const owner = String(authorId || '').toLowerCase();
    const storedPath = String(path || '');
    const match = storedPath.match(ownedPathPattern);
    if (!userIdPattern.test(owner) || !match || match[1].toLowerCase() !== owner) return;

    // Storage bucket is public by design; never interpolate arbitrary remote URLs.
    const url = client?.storage?.from('author-avatars')?.getPublicUrl(storedPath)?.data?.publicUrl;
    if (!url) return;
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    holder.dataset.avatarPath = storedPath;
    image.onload = () => {
      if (holder.isConnected && holder.dataset.avatarPath === storedPath) holder.replaceChildren(image);
    };
    image.onerror = () => {
      if (holder.dataset.avatarPath === storedPath) holder.replaceChildren(fallback);
    };
    image.src = url;
  }

  window.NovelightPublicAvatar = Object.freeze({ paint });
})();
