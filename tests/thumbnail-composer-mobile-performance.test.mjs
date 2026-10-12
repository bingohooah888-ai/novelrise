import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('novelight-thumbnail-composer.js', 'utf8');

function createRuntime() {
  const imageLoads = [];
  class FakeImage {
    naturalWidth = 1024;
    naturalHeight = 1536;
    width = 1024;
    height = 1536;

    set src(value) {
      imageLoads.push(value);
      queueMicrotask(() => this.onload?.());
    }
  }
  const context = { window: {}, Image: FakeImage, console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { composer: context.window.NovelightThumbnailComposer, imageLoads };
}

function createCanvas() {
  const calls = [];
  const context = {
    setTransform(...args) {
      calls.push(['setTransform', ...args]);
    },
    clearRect(...args) {
      calls.push(['clearRect', ...args]);
    },
    drawImage(...args) {
      calls.push(['drawImage', ...args]);
    },
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    transform() {}
  };
  return { width: 0, height: 0, calls, getContext: () => context };
}

function fixture(options = {}) {
  const template = {
    template_key: 'fixed',
    canvas_width: 1086,
    canvas_height: 1448,
    cover_quad_space: 'canvas',
    cover_top_left_x: 180,
    cover_top_left_y: 240,
    cover_top_right_x: 860,
    cover_top_right_y: 260,
    cover_bottom_right_x: 820,
    cover_bottom_right_y: 1130,
    cover_bottom_left_x: 200,
    cover_bottom_left_y: 1110
  };
  const assets = [
    {
      id: 'background',
      image_url: 'https://example.test/background.png',
      layer_type: 'background'
    },
    {
      id: 'book',
      image_url: 'https://example.test/book.png',
      layer_type: 'base_book'
    }
  ];
  if (options.pattern) {
    assets.push({
      id: 'pattern',
      image_url: 'https://example.test/pattern.png',
      layer_type: 'pattern'
    });
  }
  return {
    library: { templates: [template], assets },
    selection: {
      template_key: 'fixed',
      background_asset_id: 'background',
      base_book_asset_id: 'book',
      pattern_asset_id: options.pattern ? 'pattern' : null,
      symbol_asset_id: null,
      frame_asset_id: null,
      cover_asset_id: null
    }
  };
}

test('mobile preview uses half-resolution raster and full export', async () => {
  const { composer } = createRuntime();
  const { library, selection } = fixture({ pattern: true });
  const preview = createCanvas();
  const saved = createCanvas();
  const shown = await composer.renderSelectionToCanvas({
    canvas: preview,
    library,
    selection,
    preview: true
  });
  assert.equal(shown, preview);
  assert.equal(preview.width, 543);
  assert.equal(preview.height, 724);
  const previewTransform = preview.calls.find(
    (entry) => entry[0] === 'setTransform'
  );
  assert.deepEqual(previewTransform.slice(1), [0.5, 0, 0, 0.5, 0, 0]);

  const finished = await composer.renderSelectionToCanvas({
    canvas: saved,
    library,
    selection
  });
  assert.equal(finished, saved);
  assert.equal(saved.width, 1086);
  assert.equal(saved.height, 1448);
  const finalTransform = saved.calls.find(
    (entry) => entry[0] === 'setTransform'
  );
  assert.deepEqual(finalTransform.slice(1), [1, 0, 0, 1, 0, 0]);
  const drawCount = (canvas) =>
    canvas.calls.filter((entry) => entry[0] === 'drawImage').length;
  assert.equal(drawCount(preview), drawCount(saved));
});

test('repeated rendering reuses decoded image objects', async () => {
  const { composer, imageLoads } = createRuntime();
  const { library, selection } = fixture();
  await composer.renderSelectionToCanvas({
    canvas: createCanvas(),
    library,
    selection,
    preview: true
  });
  await composer.renderSelectionToCanvas({
    canvas: createCanvas(),
    library,
    selection,
    preview: true
  });
  assert.equal(imageLoads.length, 2);
});

test('superseded render does not paint stale imagery', async () => {
  const { composer } = createRuntime();
  const { library, selection } = fixture();
  let cancelled = false;
  const canvas = createCanvas();
  const operation = composer.renderSelectionToCanvas({
    canvas,
    library,
    selection,
    preview: true,
    shouldCancel: () => cancelled
  });
  cancelled = true;
  assert.equal(await operation, null);
  assert.equal(
    canvas.calls.filter((entry) => entry[0] === 'drawImage').length,
    0
  );
});

test('options load on accordion open and export stays isolated', () => {
  assert.match(source, /if \(section\.open\) populateOptions\(\)/u);
  assert.match(source, /function populateOptions\(\)/u);
  assert.match(source, /populateOptions\(\);\s*state\.openLayerType = type/u);
  assert.match(source, /previewTimer = window\.setTimeout\(async \(\) =>/u);
  assert.match(source, /shouldCancel: \(\) => serial !== state\.renderSerial/u);
  assert.match(source, /canvas: document\.createElement\('canvas'\)/u);
  assert.match(source, /const IMAGE_CACHE_LIMIT = 8/u);
});
