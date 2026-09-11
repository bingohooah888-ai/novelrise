(function () {
  'use strict';

  const CANVAS_WIDTH = 1086;
  const CANVAS_HEIGHT = 1448;
  const REQUIRED_TYPES = ['background', 'base_book', 'cover'];
  const OPTIONAL_TYPES = ['pattern', 'symbol', 'frame', 'effect'];
  const SURFACE_TYPES = ['cover', 'pattern', 'symbol', 'frame'];
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
  const QUAD_FIELDS =
    'cover_mask_source,cover_mask_revision,cover_mask_url,cover_top_left_x,cover_top_left_y,cover_top_right_x,cover_top_right_y,cover_bottom_right_x,cover_bottom_right_y,cover_bottom_left_x,cover_bottom_left_y';
  const TEMPLATE_SELECT_GEOMETRY =
    `template_key,label,canvas_width,canvas_height,availability_status,effect_allow_outside_cover,${QUAD_FIELDS}`;
  const TEMPLATE_SELECT_GEOMETRY_COMPAT =
    `template_key,label,canvas_width,canvas_height,availability_status,${QUAD_FIELDS}`;
  const EPSILON = 1e-9;
  const PERSPECTIVE_COLUMNS = 12;
  const PERSPECTIVE_ROWS = 16;

  function schemaUnavailable(error) {
    return ['42P01', '42703', '42883'].includes(error?.code);
  }

  function finitePoint(value) {
    if (!value || typeof value !== 'object') return null;
    const x = Number(value.x);
    const y = Number(value.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function quadPoints(quad) {
    return [quad.top_left, quad.top_right, quad.bottom_right, quad.bottom_left];
  }

  function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function polygonArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      sum += current.x * next.y - next.x * current.y;
    }
    return sum / 2;
  }

  function createHomography(quad) {
    const [p0, p1, p2, p3] = quadPoints(quad);
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const sy = p0.y - p1.y + p2.y - p3.y;

    let g = 0;
    let h = 0;
    if (Math.abs(sx) > EPSILON || Math.abs(sy) > EPSILON) {
      const denominator = dx1 * dy2 - dx2 * dy1;
      if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) {
        throw new Error('Perspective Transform is singular');
      }
      g = (sx * dy2 - dx2 * sy) / denominator;
      h = (dx1 * sy - sx * dy1) / denominator;
    }

    const matrix = {
      a: p1.x - p0.x + g * p1.x,
      b: p3.x - p0.x + h * p3.x,
      c: p0.x,
      d: p1.y - p0.y + g * p1.y,
      e: p3.y - p0.y + h * p3.y,
      f: p0.y,
      g,
      h
    };
    if (Object.values(matrix).some((value) => !Number.isFinite(value))) {
      throw new Error('Perspective Transform contains non-finite values');
    }
    return matrix;
  }

  function projectUnitPoint(matrix, u, v) {
    const denominator = matrix.g * u + matrix.h * v + 1;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) {
      throw new Error('Perspective Transform is unstable');
    }
    return {
      x: (matrix.a * u + matrix.b * v + matrix.c) / denominator,
      y: (matrix.d * u + matrix.e * v + matrix.f) / denominator
    };
  }

  function validateQuad(rawQuad, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
    const errors = [];
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { valid: false, errors: ['Invalid template canvas'], quad: null, homography: null };
    }

    const names = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];
    const quad = {};
    for (const name of names) {
      const point = finitePoint(rawQuad?.[name]);
      if (!point) {
        errors.push(`${name} must contain finite x/y coordinates`);
        continue;
      }
      if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
        errors.push(`${name} is outside the template canvas`);
      }
      quad[name] = point;
    }
    if (errors.length) return { valid: false, errors, quad: null, homography: null };

    const points = quadPoints(quad);
    const unique = new Set(points.map((point) => `${point.x}:${point.y}`));
    if (unique.size !== 4) errors.push('Cover quad vertices must be unique');

    const area = Math.abs(polygonArea(points));
    if (!Number.isFinite(area) || area < 100) errors.push('Cover quad is too small');

    const turns = points.map((current, index) =>
      cross(current, points[(index + 1) % 4], points[(index + 2) % 4])
    );
    if (
      turns.some((value) => !Number.isFinite(value) || Math.abs(value) < EPSILON) ||
      !turns.every((value) => Math.sign(value) === Math.sign(turns[0]))
    ) {
      errors.push('Cover quad must be a non-self-intersecting convex quadrilateral');
    }

    let homography = null;
    if (!errors.length) {
      try {
        homography = createHomography(quad);
        const probes = [
          [0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]
        ];
        for (const [u, v] of probes) projectUnitPoint(homography, u, v);
      } catch (error) {
        errors.push(error.message || 'Perspective Transform is invalid');
      }
    }
    return { valid: errors.length === 0, errors, quad, homography, area };
  }

  function templateQuad(template) {
    const quad = {
      top_left: { x: Number(template?.cover_top_left_x), y: Number(template?.cover_top_left_y) },
      top_right: { x: Number(template?.cover_top_right_x), y: Number(template?.cover_top_right_y) },
      bottom_right: { x: Number(template?.cover_bottom_right_x), y: Number(template?.cover_bottom_right_y) },
      bottom_left: { x: Number(template?.cover_bottom_left_x), y: Number(template?.cover_bottom_left_y) }
    };
    const validation = validateQuad(
      quad,
      Number(template?.canvas_width) || CANVAS_WIDTH,
      Number(template?.canvas_height) || CANVAS_HEIGHT
    );
    return validation.valid ? validation.quad : null;
  }

  function clipToCoverQuad(context, quad) {
    context.beginPath();
    context.moveTo(quad.top_left.x, quad.top_left.y);
    context.lineTo(quad.top_right.x, quad.top_right.y);
    context.lineTo(quad.bottom_right.x, quad.bottom_right.y);
    context.lineTo(quad.bottom_left.x, quad.bottom_left.y);
    context.closePath();
    context.clip();
  }

  function affineForTriangle(source, destination) {
    const [s0, s1, s2] = source;
    const [d0, d1, d2] = destination;
    const determinant =
      s0.x * (s1.y - s2.y) +
      s1.x * (s2.y - s0.y) +
      s2.x * (s0.y - s1.y);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) return null;
    return {
      a: (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / determinant,
      c: (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / determinant,
      e: (
        d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)
      ) / determinant,
      b: (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / determinant,
      d: (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / determinant,
      f: (
        d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)
      ) / determinant
    };
  }

  function drawImageTriangle(context, image, source, destination) {
    const transform = affineForTriangle(source, destination);
    if (!transform) return;
    context.save();
    context.beginPath();
    context.moveTo(destination[0].x, destination[0].y);
    context.lineTo(destination[1].x, destination[1].y);
    context.lineTo(destination[2].x, destination[2].y);
    context.closePath();
    context.clip();
    context.transform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f
    );
    context.drawImage(image, 0, 0);
    context.restore();
  }

  function drawPerspectiveImage(
    context,
    image,
    rawQuad,
    { columns = PERSPECTIVE_COLUMNS, rows = PERSPECTIVE_ROWS } = {}
  ) {
    const validation = validateQuad(rawQuad, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const matrix = validation.homography;
    const sourceWidth = Number(image?.naturalWidth || image?.width);
    const sourceHeight = Number(image?.naturalHeight || image?.height);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new Error('Perspective source image has invalid dimensions');
    }
    const gridColumns = Math.max(1, Math.min(40, Math.trunc(columns)));
    const gridRows = Math.max(1, Math.min(50, Math.trunc(rows)));

    context.save();
    clipToCoverQuad(context, validation.quad);
    for (let row = 0; row < gridRows; row += 1) {
      const v0 = row / gridRows;
      const v1 = (row + 1) / gridRows;
      for (let column = 0; column < gridColumns; column += 1) {
        const u0 = column / gridColumns;
        const u1 = (column + 1) / gridColumns;
        const src00 = { x: u0 * sourceWidth, y: v0 * sourceHeight };
        const src10 = { x: u1 * sourceWidth, y: v0 * sourceHeight };
        const src11 = { x: u1 * sourceWidth, y: v1 * sourceHeight };
        const src01 = { x: u0 * sourceWidth, y: v1 * sourceHeight };
        const dst00 = projectUnitPoint(matrix, u0, v0);
        const dst10 = projectUnitPoint(matrix, u1, v0);
        const dst11 = projectUnitPoint(matrix, u1, v1);
        const dst01 = projectUnitPoint(matrix, u0, v1);
        drawImageTriangle(context, image, [src00, src10, src11], [dst00, dst10, dst11]);
        drawImageTriangle(context, image, [src00, src11, src01], [dst00, dst11, dst01]);
      }
    }
    context.restore();
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
      Number(template.canvas_height) !== CANVAS_HEIGHT ||
      template.cover_mask_source !== 'cover_quad' ||
      !templateQuad(template)
    ) {
      return false;
    }
    return REQUIRED_TYPES.every(
      (layerType) => assetsFor(library, template.template_key, layerType).length > 0
    );
  }

  async function loadTemplateRows(client) {
    let result = await client
      .from('novel_thumbnail_templates')
      .select(TEMPLATE_SELECT_GEOMETRY)
      .eq('availability_status', 'active')
      .order('created_at', { ascending: true });
    if (result.error?.code === '42703') {
      result = await client
        .from('novel_thumbnail_templates')
        .select(TEMPLATE_SELECT_GEOMETRY_COMPAT)
        .eq('availability_status', 'active')
        .order('created_at', { ascending: true });
      if (!result.error) {
        result.data = (result.data ?? []).map((template) => ({
          ...template,
          effect_allow_outside_cover: false
        }));
      }
    }
    return result;
  }

  async function loadLibrary(client) {
    const templatesResult = await loadTemplateRows(client);
    if (templatesResult.error) {
      if (schemaUnavailable(templatesResult.error)) {
        return { ready: false, reason: 'schema', templates: [], assets: [] };
      }
      throw templatesResult.error;
    }
    const assetsResult = await client
      .from('novel_thumbnail_assets')
      .select('id,label,image_url,layer_type,template_key,sort_order,availability_status')
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
    library.templates = library.templates.filter((template) => usableTemplate(library, template));
    if (!library.templates.length) return { ...library, ready: false, reason: 'materials' };
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

  async function drawPerspectiveAsset(context, asset, quad) {
    if (!asset?.image_url) return;
    const image = await loadImage(asset.image_url);
    drawPerspectiveImage(context, image, quad);
  }

  async function renderSelectionToCanvas({ canvas, library, selection }) {
    const template = library.templates.find((item) => item.template_key === selection.template_key);
    if (!template) throw new Error('Thumbnail template is unavailable');
    const quad = templateQuad(template);
    if (!quad) throw new Error('Thumbnail template geometry is invalid');

    const byId = assetMap(library.assets);
    const selected = Object.fromEntries(
      LAYER_TYPES.map((type) => [
        type,
        selection[`${type}_asset_id`] ? byId.get(String(selection[`${type}_asset_id`])) : null
      ])
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
    for (const type of SURFACE_TYPES) await drawPerspectiveAsset(context, selected[type], quad);

    if (selected.effect) {
      if (template.effect_allow_outside_cover === true) {
        await drawAsset(context, selected.effect, CANVAS_WIDTH, CANVAS_HEIGHT);
      } else {
        context.save();
        clipToCoverQuad(context, quad);
        await drawAsset(context, selected.effect, CANVAS_WIDTH, CANVAS_HEIGHT);
        context.restore();
      }
    }
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
      action: 'prepare-upload', novelId: String(novelId), revision, fileSize: blob.size
    });
    const upload = await client.storage
      .from('novel-thumbnail-renders')
      .uploadToSignedUrl(prepared.path, prepared.token, blob, {
        contentType: 'image/webp', upsert: false
      });
    if (upload.error) throw upload.error;
    return renderRequest(accessToken, {
      action: 'finalize-upload', novelId: String(novelId), revision, path: prepared.path
    });
  }

  function createController({ client, root, library, current = null }) {
    const state = {
      templateKey:
        current?.template_key && library.templates.some((item) => item.template_key === current.template_key)
          ? current.template_key
          : library.templates[0].template_key,
      selected: {}, dirty: !current, renderSerial: 0
    };
    const currentKeys = Object.freeze({
      background: 'background_asset_id', base_book: 'base_book_asset_id', cover: 'cover_asset_id',
      pattern: 'pattern_asset_id', symbol: 'symbol_asset_id', frame: 'frame_asset_id', effect: 'effect_asset_id'
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
        if (serial === state.renderSerial) previewStatus.textContent = '一部素材を読み込めませんでした。';
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
        if (!REQUIRED_TYPES.includes(type)) options.appendChild(optionButton(type, null, !state.selected[type]));
        for (const asset of assetsFor(library, state.templateKey, type)) {
          options.appendChild(optionButton(type, asset, String(asset.id) === String(state.selected[type])));
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
        peer.setAttribute('aria-pressed', peer.dataset.assetId === state.selected[type] ? 'true' : 'false');
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
          render = await cacheRender({ client, accessToken, novelId, revision, canvas });
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

  const geometry = Object.freeze({
    validateQuad,
    validateCoverQuad: validateQuad,
    createHomography,
    projectUnitPoint,
    clipToCoverQuad,
    drawPerspectiveImage,
    templateQuad
  });

  window.NovelightThumbnailComposer = Object.freeze({
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    mount,
    loadLibrary,
    renderSelectionToCanvas,
    geometry
  });
})();
