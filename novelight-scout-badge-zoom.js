(() => {
  const sourceHost = document.getElementById('badgeDialogArtwork');
  const sourceImage = document.getElementById('badgeDialogArtworkImage');
  const zoomDialog = document.getElementById('badgeArtworkZoomDialog');
  const zoomStage = document.getElementById('badgeArtworkZoomStage');
  const zoomImage = document.getElementById('badgeArtworkZoomImage');
  const closeButton = document.querySelector('[data-badge-artwork-zoom-close]');

  if (!sourceHost || !sourceImage || !zoomDialog || !zoomStage || !zoomImage) {
    return;
  }

  sourceHost.setAttribute('role', 'button');
  sourceHost.setAttribute('tabindex', '0');
  sourceHost.setAttribute('aria-haspopup', 'dialog');
  sourceHost.setAttribute('aria-label', '称号紋章をさらに大きく表示');
  sourceHost.title = 'クリックで称号紋章をさらに拡大';

  function closeZoom() {
    if (typeof zoomDialog.close === 'function' && zoomDialog.open) {
      zoomDialog.close();
    } else {
      zoomDialog.removeAttribute('open');
    }
  }

  function openZoom() {
    const source = sourceImage.getAttribute('src');
    if (sourceHost.hidden || !source) return;

    zoomImage.src = sourceImage.currentSrc || source;
    zoomImage.alt = sourceImage.alt || '称号紋章';

    if (zoomDialog.open) return;
    if (typeof zoomDialog.showModal === 'function') {
      zoomDialog.showModal();
    } else {
      zoomDialog.setAttribute('open', '');
    }
  }

  sourceHost.addEventListener('click', openZoom);
  sourceHost.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openZoom();
  });

  closeButton?.addEventListener('click', closeZoom);

  zoomDialog.addEventListener('click', (event) => {
    if (event.target === zoomDialog || event.target === zoomStage) {
      closeZoom();
    }
  });

  zoomDialog.addEventListener('close', () => {
    zoomImage.removeAttribute('src');
    zoomImage.alt = '';
  });
})();
