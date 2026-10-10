import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(
  new URL('../novelight-x-image-share.js', import.meta.url),
  'utf8'
);

function setup({ thumbnail = '', authorImage = '', compositionImage = '', mobile = false } = {}) {
  const calls = { fetched: [], shared: null, copied: null, intent: null, canvas: 0 };
  const imageUrl = 'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/cover.webp';
  const target = compositionImage;
  const chain = (value) => ({
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: value, error: null }; }
  });
  const db = {
    from(table) {
      if (table === 'novels') {
        return chain({
          thumbnail_url: thumbnail,
          thumbnail_asset_id: authorImage ? 321 : null,
          status: 'published'
        });
      }
      if (table === 'novel_thumbnail_assets') {
        return chain({ image_url: authorImage });
      }
      throw new Error('Unexpected table: ' + table);
    },
    async rpc() {
      return { data: target ? [{ render_url: target }] : [], error: null };
    }
  };
  const nav = {
    canShare: () => mobile,
    async share(payload) { calls.shared = payload; },
    clipboard: {
      async write(items) { calls.copied = items; }
    }
  };
  const mockContext = {
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {},
    strokeRect() {},
    fillText() {},
    drawImage() {}
  };
  const ctx = {
    URL,
    Blob,
    File: class {
      constructor(items, name, opts) {
        this.name = name;
        this.type = opts.type;
        this.size = items.reduce((sum, part) => sum + part.size, 0);
      }
    },
    ClipboardItem: class {
      constructor(items) { this.items = items; }
    },
    AbortSignal,
    navigator: nav,
    console: { warn() {} },
    document: {
      body: { appendChild() {} },
      createElement(tag) {
        if (tag === 'canvas') {
          calls.canvas += 1;
          return {
            getContext: () => mockContext,
            toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' }))
          };
        }
        return { click() {}, remove() {} };
      }
    },
    window: {
      supabase: { createClient: () => db },
      setTimeout() {},
      open() {
        return {
          closed: false,
          opener: null,
          location: { replace(url) { calls.intent = url; } }
        };
      }
    },
    fetch: async (url) => {
      calls.fetched.push(url);
      return {
        ok: true,
        headers: {
          get(name) {
            if (name === 'content-type') return 'image/webp';
            if (name === 'content-length') return '100';
            return null;
          }
        },
        blob: async () => new Blob(['webp'], { type: 'image/webp' })
      };
    },
    createImageBitmap: async () => ({
      width: 1024,
      height: 1536,
      close() {}
    })
  };
  runInNewContext(script, ctx, { filename: 'novelight-x-image-share.js' });
  return { engine: ctx.window.NovelightXImageShare, calls };
}

test('author thumbnail takes priority and becomes a PNG share file', async () => {
  const image = 'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/author.webp';
  const { engine, calls } = setup({ authorImage: image, thumbnail: 'https://novelight.jp/assets/fallback.webp' });
  const file = await engine.prepare(354).promise;
  assert.equal(calls.fetched[0], image);
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'NOVELIGHT-354.png');
});

test('no configured thumbnail generates the NOVELIGHT default without fetching a cover', async () => {
  const { engine, calls } = setup();
  const file = await engine.prepare(354).promise;
  assert.equal(file.type, 'image/png');
  assert.equal(calls.fetched.length, 0);
  assert.ok(calls.canvas >= 1);
});

test('published Geometry render is used when thumbnail_url is absent', async () => {
  const compositionImage = 'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/render.webp';
  const { engine, calls } = setup({ compositionImage });
  await engine.prepare(354).promise;
  assert.equal(calls.fetched[0], compositionImage);
});

test('native sharing passes image, title, and URL together', async () => {
  const { engine, calls } = setup({ mobile: true });
  await engine.prepare(354).promise;
  await engine.share({ novelId: 354, title: '作品名', url: 'https://novelight.jp/novel.html?id=354' });
  assert.equal(calls.shared.files[0].type, 'image/png');
  assert.equal(calls.shared.url, 'https://novelight.jp/novel.html?id=354');
  assert.match(calls.shared.text, /作品名/);
});

test('desktop copies the PNG before opening the canonical X intent', async () => {
  const { engine, calls } = setup();
  await engine.prepare(354).promise;
  await engine.share({ novelId: 354, title: '作品名', url: 'https://novelight.jp/novel.html?id=354' });
  assert.ok(calls.copied);
  const intent = new URL(calls.intent);
  assert.equal(intent.searchParams.get('url'), 'https://novelight.jp/novel.html?id=354');
  assert.match(intent.searchParams.get('text'), /作品名/);
});
