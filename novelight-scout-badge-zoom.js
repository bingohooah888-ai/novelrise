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

  let enhancedObjectUrl = '';
  let renderVersion = 0;

  sourceHost.setAttribute('role', 'button');
  sourceHost.setAttribute('tabindex', '0');
  sourceHost.setAttribute('aria-haspopup', 'dialog');
  sourceHost.setAttribute('aria-label', '称号紋章をさらに大きく表示');
  sourceHost.title = 'クリックで称号紋章をさらに拡大';

  function clearEnhancedObjectUrl() {
    if (!enhancedObjectUrl) return;
    URL.revokeObjectURL(enhancedObjectUrl);
    enhancedObjectUrl = '';
  }

  function sharpenImageData(imageData, width, height, amount = 0.14) {
    const data = imageData.data;
    const source = new Uint8ClampedArray(data);
    const rowStride = width * 4;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * rowStride + x * 4;
        const left = index - 4;
        const right = index + 4;
        const up = index - rowStride;
        const down = index + rowStride;

        // Preserve the transparent anti-aliased edge instead of sharpening against
        // transparent black pixels, which would create a visible halo.
        if (
          source[index + 3] < 64 ||
          source[left + 3] < 64 ||
          source[right + 3] < 64 ||
          source[up + 3] < 64 ||
          source[down + 3] < 64
        ) {
          continue;
        }

        for (let channel = 0; channel < 3; channel += 1) {
          const value =
            source[index + channel] * (1 + amount * 4) -
            amount *
              (source[left + channel] +
                source[right + channel] +
                source[up + channel] +
                source[down + channel]);
          data[index + channel] = Math.max(0, Math.min(255, Math.round(value)));
        }
      }
    }
  }

  async function createEnhancedZoomSource() {
    try {
      if (!sourceImage.complete || !sourceImage.naturalWidth || !sourceImage.naturalHeight) {
        await sourceImage.decode();
      }

      const naturalWidth = sourceImage.naturalWidth;
      const naturalHeight = sourceImage.naturalHeight;
      if (!naturalWidth || !naturalHeight) return '';

      const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
      const displayLimit = Math.max(
        256,
        Math.min(640, viewportWidth * 0.8, viewportHeight - 112),
      );
      const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const targetLongEdge = Math.min(
        1024,
        Math.max(Math.max(naturalWidth, naturalHeight), Math.round(displayLimit * density)),
      );

      // If the source already has enough pixels, the browser can render it directly.
      if (Math.max(naturalWidth, naturalHeight) >= targetLongEdge * 0.95) return '';

      const scale = targetLongEdge / Math.max(naturalWidth, naturalHeight);
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!context) return '';

      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(sourceImage, 0, 0, width, height);

      const pixels = context.getImageData(0, 0, width, height);
      sharpenImageData(pixels, width, height);
      context.putImageData(pixels, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return '';
      return URL.createObjectURL(blob);
    } catch (error) {
      console.warn('SCOUT badge zoom enhancement skipped:', error);
      return '';
    }
  }

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

    renderVersion += 1;
    const currentVersion = renderVersion;
    clearEnhancedObjectUrl();

    zoomImage.src = sourceImage.currentSrc || source;
    zoomImage.alt = sourceImage.alt || '称号紋章';

    if (!zoomDialog.open) {
      if (typeof zoomDialog.showModal === 'function') {
        zoomDialog.showModal();
      } else {
        zoomDialog.setAttribute('open', '');
      }
    }

    // The card/detail artwork is intentionally lightweight. For the second-stage
    // zoom, redraw it once at the actual display size and apply a restrained
    // sharpening pass so browser enlargement does not look soft or smeared.
    createEnhancedZoomSource().then((enhancedSource) => {
      if (!enhancedSource) return;
      if (currentVersion !== renderVersion || !zoomDialog.open) {
        URL.revokeObjectURL(enhancedSource);
        return;
      }

      clearEnhancedObjectUrl();
      enhancedObjectUrl = enhancedSource;
      zoomImage.src = enhancedObjectUrl;
    });
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
    renderVersion += 1;
    clearEnhancedObjectUrl();
    zoomImage.removeAttribute('src');
    zoomImage.alt = '';
  });
})();
