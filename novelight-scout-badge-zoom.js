(() => {
  const OPTIMIZER_PREFIX = '/_vercel/image?';
  const CARD_WIDTH = 384;
  const CARD_QUALITY = 80;
  const DETAIL_WIDTH = 640;
  const DETAIL_QUALITY = 85;
  const originalSourceAttribute = 'data-novelight-original-src';

  function isScoutArtworkSource(value) {
    const source = String(value || '');
    return (
      /(?:^|\/)assets\/scout-badges\//.test(source) ||
      /(?:^|\/)assets\/founding-authors-badge-2026\.png(?:$|[?#])/.test(source) ||
      /(?:^|\/)assets\/scout-record\/ranks\//.test(source)
    );
  }

  function optimizedScoutArtworkSource(value, width = CARD_WIDTH, quality = CARD_QUALITY) {
    const source = String(value || '').trim();
    if (!source || source.startsWith(OPTIMIZER_PREFIX)) return source;

    try {
      const parsed = new URL(source, window.location.origin);
      if (parsed.origin !== window.location.origin) return source;
      const optimizerSource = `${parsed.pathname}${parsed.search}`;
      return `${OPTIMIZER_PREFIX}url=${encodeURIComponent(optimizerSource)}&w=${width}&q=${quality}`;
    } catch {
      return source;
    }
  }

  function installDeferredBadgeArtworkLoading() {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src'
    );
    if (!descriptor?.get || !descriptor?.set || !descriptor.configurable) return;

    const nativeSetSrc = descriptor.set;
    const deferredAttribute = 'data-novelight-deferred-src';

    let observer;
    const hydrate = (image) => {
      const source = image.getAttribute(deferredAttribute);
      if (!source) return;
      image.removeAttribute(deferredAttribute);
      observer?.unobserve(image);
      nativeSetSrc.call(image, source);
    };

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        const source = String(value || '');
        if (!isScoutArtworkSource(source)) {
          nativeSetSrc.call(this, value);
          return;
        }

        if (source.startsWith(OPTIMIZER_PREFIX)) {
          nativeSetSrc.call(this, source);
          return;
        }

        this.setAttribute(originalSourceAttribute, source);

        if (this.id === 'badgeArtworkZoomImage') {
          nativeSetSrc.call(this, source);
          return;
        }

        if (this.id === 'badgeDialogArtworkImage') {
          nativeSetSrc.call(
            this,
            optimizedScoutArtworkSource(source, DETAIL_WIDTH, DETAIL_QUALITY)
          );
          return;
        }

        const optimizedSource = optimizedScoutArtworkSource(
          source,
          CARD_WIDTH,
          CARD_QUALITY
        );

        if (!('IntersectionObserver' in window)) {
          nativeSetSrc.call(this, optimizedSource);
          this.loading = 'lazy';
          this.decoding = 'async';
          if ('fetchPriority' in this) this.fetchPriority = 'low';
          return;
        }

        this.removeAttribute('src');
        this.setAttribute(deferredAttribute, optimizedSource);
        this.loading = 'lazy';
        this.decoding = 'async';
        if ('fetchPriority' in this) this.fetchPriority = 'low';
      }
    });

    if (!('IntersectionObserver' in window)) return;

    const mobile = window.matchMedia('(max-width: 768px)').matches;
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) hydrate(entry.target);
        });
      },
      {
        root: null,
        rootMargin: mobile ? '240px 0px' : '640px 0px',
        threshold: 0.01
      }
    );

    const observeTree = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(`img[${deferredAttribute}]`)) observer.observe(node);
      node
        .querySelectorAll(`img[${deferredAttribute}]`)
        .forEach((image) => observer.observe(image));
    };

    const unobserveTree = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(`img[${deferredAttribute}]`)) observer.unobserve(node);
      node
        .querySelectorAll(`img[${deferredAttribute}]`)
        .forEach((image) => observer.unobserve(image));
    };

    const mutations = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach(observeTree);
        record.removedNodes.forEach(unobserveTree);
      });
    });
    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    observeTree(document.documentElement);
  }

  installDeferredBadgeArtworkLoading();

  const sourceHost = document.getElementById('badgeDialogArtwork');
  const sourceImage = document.getElementById('badgeDialogArtworkImage');
  const zoomDialog = document.getElementById('badgeArtworkZoomDialog');
  const zoomStage = document.getElementById('badgeArtworkZoomStage');
  const zoomImage = document.getElementById('badgeArtworkZoomImage');
  const closeButton = document.querySelector('[data-badge-artwork-zoom-close]');

  if (!sourceHost || !sourceImage || !zoomDialog || !zoomStage || !zoomImage) {
    return;
  }

  let renderVersion = 0;

  sourceHost.setAttribute('role', 'button');
  sourceHost.setAttribute('tabindex', '0');
  sourceHost.setAttribute('aria-haspopup', 'dialog');
  sourceHost.setAttribute('aria-label', '称号紋章をさらに大きく表示');
  sourceHost.title = 'クリックで称号紋章をさらに拡大';

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
    if (sourceImage.getAttribute(originalSourceAttribute)) return '';

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

      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl === 'data:,' ? '' : dataUrl;
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
    const displayedSource = sourceImage.getAttribute('src');
    const originalSource =
      sourceImage.getAttribute(originalSourceAttribute) || displayedSource;
    if (sourceHost.hidden || !originalSource) return;

    renderVersion += 1;
    const currentVersion = renderVersion;

    zoomImage.src = originalSource;
    zoomImage.alt = sourceImage.alt || '称号紋章';

    if (!zoomDialog.open) {
      if (typeof zoomDialog.showModal === 'function') {
        zoomDialog.showModal();
      } else {
        zoomDialog.setAttribute('open', '');
      }
    }

    createEnhancedZoomSource().then((enhancedSource) => {
      if (!enhancedSource) return;
      if (currentVersion !== renderVersion || !zoomDialog.open) return;
      zoomImage.src = enhancedSource;
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
    zoomImage.removeAttribute('src');
    zoomImage.removeAttribute(originalSourceAttribute);
    zoomImage.alt = '';
  });
})();
