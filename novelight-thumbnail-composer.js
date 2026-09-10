(function () {
  'use strict';

  const CANVAS_WIDTH = 1086;
  const CANVAS_HEIGHT = 1448;
  const REQUIRED_TYPES = ['background', 'base_book', 'cover'];
  const OPTIONAL_TYPES = ['pattern', 'symbol', 'frame', 'effect'];
  const LAYER_TYPES = [...REQUIRED_TYPES, ...OPTIONAL_TYPES];
  const LABELS = Object.freeze({
    background: '背景',
    base_book: '基準本',
    cover: '表紙カラー・質感',
    pattern: '背景模様',
    symbol: '中央シンボル',
    frame: '枠・四隅装飾',
    effect: '光・エフェクト'
  });

  function schemaUnavailable(error) {
    return ['42P01', '42703', '42883'].includes(error?.code);
  }

  function assetMap(assets) {
    return new Map((assets ?? []).map((asset) => [String(asset.id), asset]));
  }

  function assetsFor(library, templateKey, layerType) {
    return library.assets.filter(
      (asset) =>
        asset.template_key === templateKey &&
        asset.layer_type === layerType &&
        asset.availability_status === 'active'
    );
  }

  function usableTemplate(library, template) {
    if (
      template.availability_status !== 'active' ||
      Number(template.canvas_width) !== CANVAS_WIDTH ||
      Number(template.canvas_height) !== CANVAS_HEIGHT
    ) {
      return false;
    }
    return REQUIRED_TYPES.every(
      (layerType) => assetsFor(library, template.template_key, layerType).length > 0
    );
  }

  async function loadLibrary(client) {
    const templatesResult = await client
      .from('novel_thumbnail_templates')
      .select(
        'template_key,label,canvas_width,canvas_height,cover_mask_url,availability_status'
      )
      .eq('availability_status', 'active')
      .order('created_at', { ascending: true });

    if (templatesResult.error) {
      if (schemaUnavailable(templatesResult.error)) {
        return { ready: false, reason: 'schema', templates: [], assets: [] };
      }
      throw templatesResult.error;
    }

    const assetsResult = await client
      .from('novel_thumbnail_assets')
      .select(
        'id,label,image_url,layer_type,template_key,sort_order,availability_status'
      )
      .eq('availability_status', 'active')
      .neq('layer_type', 'legacy_complete')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (assetsResult.error) {
      if (schemaUnavailable(assetsResult.error)) {
        return { ready: false, reason: 'schema', templates: [], assets: [] };
      }
      throw assetsResult.error;
    }

    const library = {
      ready: true,
      templates: templatesResult.data ?? [],
      assets: assetsResult.data ?? []
    };
    library.templates = library.templates.filter((template) =>
      usableTemplate(library, template)
    );
    if (!library.templates.length) {
      return { ...library, ready: false, reason: 'materials' };
    }
    return library;
  }

  async function loadOwnedComposition(client, novelId) {
    if (!novelId) return null;
    const result = await client.rpc('novelight_my_thumbnail_composition', {
      p_novel_id: String(novelId)
    });
    if (result.error) {
      if (schemaUnavailable(result.error)) return null;
      throw result.error;
    }
    return Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Thumbnail material could not be loaded'));
      image.src = url;
    });
  }

  async function drawAsset(context, asset, width, height) {
    if (!asset?.image_url) return;
    const image = await loadImage(asset.image_url);
    context.drawImage(image, 0, 0, width, height);
  }

  async function renderSelectionToCanvas({ canvas, library, selection }) {
    const template = library.templates.find(
      (item) => item.template_key === selection.template_key
    );
    if (!template) throw new Error('Thumbnail template is unavailable');

    const byId = assetMap(library.assets);
    const selected = Object.fromEntries(
      LAYER_TYPES.map((type) => [type, selection[`${type}_asset_id`] ? byId.get(String(selection[`${type}_asset_id`])) : null])
    );

    for (const type of REQUIRED_TYPES) {
      if (!selected[type]) throw new Error(`Required thumbnail layer is missing: ${type}`);
    }

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas is unavailable');
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    await drawAsset(context, selected.background, CANVAS_WIDTH, CANVAS_HEIGHT);
    await drawAsset(context, selected.base_book, CANVAS_WIDTH, CANVAS_HEIGHT);

    const surface = document.createElement('canvas');
    surface.width = CANVAS_WIDTH;
    surface.height = CANVAS_HEIGHT;
    const surfaceContext = surface.getContext('2d', { alpha: true });
    if (!surfaceContext) throw new Error('Canvas is unavailable');

    await drawAsset(surfaceContext, selected.cover, CANVAS_WIDTH, CANVAS_HEIGHT);
    await drawAsset(surfaceContext, selected.pattern, CANVAS_WIDTH, CANVAS_HEIGHT);
    await drawAsset(surfaceContext, selected.symbol, CANVAS_WIDTH, CANVAS_HEIGHT);
    await drawAsset(surfaceContext, selected.frame, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (template.cover_mask_url) {
      const mask = await loadImage(template.cover_mask_url);
      surfaceContext.globalCompositeOperation = 'destination-in';
      surfaceContext.drawImage(mask, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      surfaceContext.globalCompositeOperation = 'source-over';
    }

    context.drawImage(surface, 0, 0);
    await drawAsset(context, selected.effect, CANVAS_WIDTH, CANVAS_HEIGHT);
    return canvas;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail render failed'))),
        'image/webp',
        0.9
      );
    });
  }

  async function renderRequest(accessToken, body) {
    const response = await fetch('/api/thumbnail-render', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function cacheRender({ client, accessToken, novelId, revision, canvas }) {
    const blob = await canvasBlob(canvas);
    const prepared = await renderRequest(accessToken, {
      action: 'prepare-upload',
      novelId: String(novelId),
      revision,
      fileSize: blob.size
    });
    const upload = await client.storage
      .from('novel-thumbnail-renders')
      .uploadToSignedUrl(prepared.path, prepared.token, blob, {
        contentType: 'image/webp',
        upsert: false
      });
    if (upload.error) throw upload.error;
    return renderRequest(accessToken, {
      action: 'finalize-upload',
      novelId: String(novelId),
      revision,
      path: prepared.path
    });
  }

  function createController({ client, root, library, current = null }) {
    const state = {
      templateKey:
        current?.template_key &&
        library.templates.some((item) => item.template_key === current.template_key)
          ? current.template_key
          : library.templates[0].template_key,
      selected: {},
      dirty: !current,
      renderSerial: 0
    };
    const currentKeys = Object.freeze({
      background: 'background_asset_id',
      base_book: 'base_book_asset_id',
      cover: 'cover_asset_id',
      pattern: 'pattern_asset_id',
      symbol: 'symbol_asset_id',
      frame: 'frame_asset_id',
      effect: 'effect_asset_id'
    });

    function seedSelection(templateKey) {
      for (const type of LAYER_TYPES) {
        const available = assetsFor(library, templateKey, type);
        const currentId = current?.[currentKeys[type]];
        const currentValid = available.some((asset) => String(asset.id) === String(currentId));
        state.selected[type] = currentValid
          ? String(currentId)
          : REQUIRED_TYPES.includes(type)
            ? String(available[0]?.id ?? '')
            : '';
      }
    }
    seedSelection(state.templateKey);

    root.classList.add('novelight-thumbnail-composer');
    root.replaceChildren();
    const layout = document.createElement('div');
    layout.className = 'nl-thumb-composer-layout';
    const controls = document.createElement('div');
    controls.className = 'nl-thumb-composer-controls';
    const preview = document.createElement('div');
    preview.className = 'nl-thumb-composer-preview';
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.setAttribute('aria-label', '作品サムネイルのプレビュー');
    const previewStatus = document.createElement('div');
    previewStatus.className = 'nl-thumb-preview-status';
    previewStatus.textContent = 'プレビューを準備しています…';
    preview.append(canvas, previewStatus);
    layout.append(controls, preview);
    root.appendChild(layout);

    function selection() {
      return {
        template_key: state.templateKey,
        background_asset_id: state.selected.background || null,
        base_book_asset_id: state.selected.base_book || null,
        cover_asset_id: state.selected.cover || null,
        pattern_asset_id: state.selected.pattern || null,
        symbol_asset_id: state.selected.symbol || null,
        frame_asset_id: state.selected.frame || null,
        effect_asset_id: state.selected.effect || null
      };
    }

    function valid() {
      return REQUIRED_TYPES.every((type) => Boolean(state.selected[type]));
    }

    async function updatePreview() {
      const serial = ++state.renderSerial;
      if (!valid()) {
        previewStatus.textContent = '必須素材を選択してください。';
        return;
      }
      previewStatus.textContent = 'プレビューを更新しています…';
      try {
        await renderSelectionToCanvas({ canvas, library, selection: selection() });
        if (serial === state.renderSerial) previewStatus.textContent = 'プレビュー';
      } catch (error) {
        console.error('thumbnail preview failed', error);
        if (serial === state.renderSerial) {
          previewStatus.textContent = '一部素材を読み込めませんでした。';
        }
      }
    }

    function optionButton(type, asset, selected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nl-thumb-option';
      button.dataset.layerType = type;
      button.dataset.assetId = asset?.id ? String(asset.id) : '';
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (!asset) {
        const none = document.createElement('span');
        none.className = 'nl-thumb-option-none';
        none.textContent = 'なし';
        button.appendChild(none);
      } else {
        const image = document.createElement('img');
        image.src = asset.image_url;
        image.alt = '';
        image.loading = 'lazy';
        const label = document.createElement('span');
        label.textContent = asset.label;
        button.append(image, label);
      }
      return button;
    }

    function renderControls() {
      controls.replaceChildren();
      if (library.templates.length > 1) {
        const templateField = document.createElement('label');
        templateField.className = 'nl-thumb-template-field';
        const title = document.createElement('span');
        title.textContent = '本のテンプレート';
        const select = document.createElement('select');
        for (const template of library.templates) {
          const option = document.createElement('option');
          option.value = template.template_key;
          option.textContent = template.label;
          option.selected = template.template_key === state.templateKey;
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          state.templateKey = select.value;
          state.dirty = true;
          seedSelection(state.templateKey);
          renderControls();
          void updatePreview();
        });
        templateField.append(title, select);
        controls.appendChild(templateField);
      }

      for (const type of LAYER_TYPES) {
        const section = document.createElement('section');
        section.className = 'nl-thumb-layer';
        const heading = document.createElement('div');
        heading.className = 'nl-thumb-layer-heading';
        const title = document.createElement('strong');
        title.textContent = LABELS[type];
        const requirement = document.createElement('span');
        requirement.textContent = REQUIRED_TYPES.includes(type) ? '必須' : '任意';
        heading.append(title, requirement);
        const options = document.createElement('div');
        options.className = 'nl-thumb-layer-options';
        if (!REQUIRED_TYPES.includes(type)) {
          options.appendChild(optionButton(type, null, !state.selected[type]));
        }
        for (const asset of assetsFor(library, state.templateKey, type)) {
          options.appendChild(
            optionButton(type, asset, String(asset.id) === String(state.selected[type]))
          );
        }
        section.append(heading, options);
        controls.appendChild(section);
      }
    }

    controls.addEventListener('click', (event) => {
      const button = event.target.closest?.('button[data-layer-type]');
      if (!button) return;
      const type = button.dataset.layerType;
      if (!LAYER_TYPES.includes(type)) return;
      state.selected[type] = button.dataset.assetId || '';
      state.dirty = true;
      for (const peer of controls.querySelectorAll(`button[data-layer-type="${type}"]`)) {
        peer.setAttribute(
          'aria-pressed',
          peer.dataset.assetId === state.selected[type] ? 'true' : 'false'
        );
      }
      void updatePreview();
    });

    renderControls();
    void updatePreview();

    return {
      isValid: valid,
      isDirty: () => state.dirty,
      selection,
      canvas,
      async persist({ novelId, accessToken }) {
        if (!valid()) throw new Error('必須のサムネイル素材を選択してください。');
        const selected = selection();
        const result = await client.rpc('novelight_set_my_thumbnail_composition', {
          p_novel_id: String(novelId),
          p_template_key: selected.template_key,
          p_background_asset_id: selected.background_asset_id,
          p_base_book_asset_id: selected.base_book_asset_id,
          p_cover_asset_id: selected.cover_asset_id,
          p_pattern_asset_id: selected.pattern_asset_id,
          p_symbol_asset_id: selected.symbol_asset_id,
          p_frame_asset_id: selected.frame_asset_id,
          p_effect_asset_id: selected.effect_asset_id
        });
        if (result.error) throw result.error;
        const saved = result.data;
        const revision = saved?.revision;
        if (!revision) throw new Error('Thumbnail revision was not returned');

        await renderSelectionToCanvas({ canvas, library, selection: selected });
        let render = null;
        let renderError = null;
        try {
          render = await cacheRender({
            client,
            accessToken,
            novelId,
            revision,
            canvas
          });
        } catch (error) {
          renderError = error;
          console.error('thumbnail render cache failed', error);
        }
        state.dirty = false;
        return { composition: saved, render, renderError };
      }
    };
  }

  async function mount({ client, root, novelId = null }) {
    if (!client || !root) throw new Error('Thumbnail composer requires client and root');
    const library = await loadLibrary(client);
    if (!library.ready) return { ready: false, reason: library.reason, library };
    const current = novelId ? await loadOwnedComposition(client, novelId) : null;
    return {
      ready: true,
      library,
      current,
      controller: createController({ client, root, library, current })
    };
  }

  window.NovelightThumbnailComposer = Object.freeze({
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    mount,
    loadLibrary,
    renderSelectionToCanvas
  });
})();
