import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile('novelight-custom-cover.js', 'utf8');
const html = await readFile('work-cover.html', 'utf8');

function control() {
  return {
    hidden: true,
    disabled: true,
    dataset: {},
    listeners: new Map(),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    removeAttribute(name) {
      delete this[name];
    }
  };
}

// The embedded browser/Storage stubs intentionally preserve their fixture shape.
// prettier-ignore
function setup() {
  const uid = '12345678-1234-4123-8123-123456789abc';
  const fields = new Map(
    [
      '[data-cover-file]',
      '[data-cover-upload]',
      '[data-cover-remove]',
      '[data-cover-preview]',
      '[data-cover-x-preview]',
      '[data-cover-status]'
    ].map((name) => [name, control()])
  );
  const root = {
    hidden: true,
    querySelector(selector) {
      return fields.get(selector);
    }
  };
  const events = [];
  const objects = new Set();
  const draws = [];
  let removedUrlCount = 0;
  let currentPath = '';
  let nextId = 0;
  const bucket = {
    getPublicUrl(path) {
      return { data: { publicUrl: 'https://example.com/' + path } };
    },
    async list(folder) {
      return { data: [...objects]
        .filter((path) => path.startsWith(folder + '/'))
        .map((path) => ({ name: path.slice(folder.length + 1) })), error: null };
    },
    async upload(path, blob, options) {
      events.push({ action: 'upload', path, blob, options });
      objects.add(path);
      return { error: null };
    },
    async remove(paths) {
      events.push({ action: 'remove', paths });
      for (const path of paths) objects.delete(path);
      return { error: null };
    }
  };
  const client = {
    storage: {
      from(name) {
        assert.equal(name, 'novel-custom-covers');
        return bucket;
      }
    },
    from(name) {
      assert.equal(name, 'novel_custom_covers');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: currentPath ? { storage_path: currentPath } : null,
            error: null
          };
        },
        async upsert(row, opts) {
          assert.equal(opts.onConflict, 'novel_id');
          currentPath = row.storage_path;
          events.push({ action: 'upsert', row });
          return { error: null };
        },
        delete() {
          return {
            async eq() {
              currentPath = '';
              events.push({ action: 'delete' });
              return { error: null };
            }
          };
        }
      };
    }
  };
  const canvas = {
    getContext() {
      return {
        fillRect() {},
        set fillStyle(value) {
          void value;
        },
        drawImage(...args) {
          draws.push(args);
        }
      };
    },
    toBlob(callback) {
      callback({ type: 'image/webp', size: 1200 });
    }
  };
  const context = {
    window: {},
    console,
    Image: class {
      naturalWidth = 600;
      naturalHeight = 600;

      set src(url) {
        this.url = url;
        this.onload();
      }
    },
    URL: {
      createObjectURL() {
        return 'blob:cover-test';
      },
      revokeObjectURL() {
        removedUrlCount += 1;
      }
    },
    crypto: {
      randomUUID() {
        return 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(++nextId).padStart(12, '0');
      }
    },
    document: {
      createElement(name) {
        assert.equal(name, 'canvas');
        return canvas;
      }
    }
  };
  runInNewContext(source, context);
  return {
    fields,
    root,
    client,
    uid,
    events,
    objects,
    draws,
    canvas,
    get revoked() {
      return removedUrlCount;
    },
    mount: context.window.NovelightCustomCover.mount
  };
}

test('empty cover preview must remain hidden even with CSS display override', () => {
  assert.match(html, /\.custom-cover img\[hidden\]\{display:none\}/u);
  assert.match(html, /class="custom-cover"[^>]*hidden/u);
});

test('mobile Image fallback uploads and removes an owner-scoped 2:3 cover', async () => {
  const app = setup();
  await app.mount({
    client: app.client,
    root: app.root,
    novelId: '42',
    session: { user: { id: app.uid } },
    published: true
  });

  assert.equal(app.root.hidden, false);
  assert.equal(app.fields.get('[data-cover-preview]').hidden, true);
  const file = app.fields.get('[data-cover-file]');
  file.files = [{ type: 'image/jpeg', size: 1300 }];
  file.listeners.get('change')();
  await app.fields.get('[data-cover-upload]').listeners.get('click')();

  assert.equal(app.canvas.width, 1200);
  assert.equal(app.canvas.height, 1800);
  assert.deepEqual(app.draws[0].slice(1), [0, 300, 1200, 1200]);
  assert.equal(app.events[0].action, 'upload');
  assert.equal(app.events[0].options.contentType, 'image/webp');
  assert.ok(app.events[0].path.startsWith(app.uid + '/42/'));
  assert.equal(app.events[1].action, 'upsert');
  assert.equal(app.fields.get('[data-cover-preview]').hidden, false);
  assert.equal(app.fields.get('[data-cover-x-preview]').hidden, false);
  assert.equal(app.revoked, 1);

  await app.fields.get('[data-cover-remove]').listeners.get('click')();
  assert.equal(app.events.at(-2).action, 'delete');
  assert.equal(app.events.at(-1).action, 'remove');
  assert.equal(app.fields.get('[data-cover-preview]').hidden, true);
  assert.equal(app.fields.get('[data-cover-x-preview]').hidden, true);
});

test('oversized user image is rejected without a storage write', async () => {
  const app = setup();
  await app.mount({
    client: app.client,
    root: app.root,
    novelId: '42',
    session: { user: { id: app.uid } }
  });
  const file = app.fields.get('[data-cover-file]');
  file.files = [{ type: 'image/png', size: 5 * 1024 * 1024 + 1 }];
  file.listeners.get('change')();
  await app.fields.get('[data-cover-upload]').listeners.get('click')();

  assert.equal(app.events.length, 0);
  assert.equal(app.fields.get('[data-cover-status]').dataset.error, 'true');
});

// Preserve the interaction stub order for the browser simulation.
// prettier-ignore
test('Safari canvas PNG fallback preserves real MIME and draft-preview safety', async () => {
  const app = setup();
  app.canvas.toBlob = (callback) => callback({ type: 'image/png', size: 1200 });
  await app.mount({
    client: app.client, root: app.root, novelId: '42',
    session: { user: { id: app.uid } }, published: false
  });
  const file = app.fields.get('[data-cover-file]');
  file.files = [{ name: 'IMG_1234.HEIC', type: 'image/heic', size: 2200 }];
  file.listeners.get('change')();
  await app.fields.get('[data-cover-upload]').listeners.get('click')();
  assert.equal(app.events[0].action, 'upload');
  assert.equal(app.events[0].options.contentType, 'image/png');
  assert.equal(app.events[0].blob.type, 'image/png');
  assert.ok(app.events[0].path.endsWith('.png'));
  assert.equal(app.fields.get('[data-cover-preview]').hidden, false);
  assert.equal(app.fields.get('[data-cover-x-preview]').hidden, true);
});

// Preserve the interaction stub order for the browser simulation.
// prettier-ignore
test('repeated replacements clean up previous uploads and preserve only one live cover', async () => {
  const app = setup();
  await app.mount({
    client: app.client, root: app.root, novelId: '42',
    session: { user: { id: app.uid } }, published: true
  });
  const file = app.fields.get('[data-cover-file]');
  for (let i = 0; i < 3; i += 1) {
    file.files = [{ name: 'story.jpeg', type: 'image/jpeg', size: 1100 }];
    file.listeners.get('change')();
    await app.fields.get('[data-cover-upload]').listeners.get('click')();
  }
  assert.equal(app.events.filter((event) => event.action === 'upsert').length, 3);
  assert.equal(app.objects.size, 1);
  assert.equal(app.fields.get('[data-cover-x-preview]').hidden, false);
});

// Preserve the interaction stub order for the browser simulation.
// prettier-ignore
test('previously uploaded draft cover never opens unavailable public OG endpoint', async () => {
  const app = setup();
  const path = app.uid + '/42/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';
  app.objects.add(path);
  const originalFrom = app.client.from;
  app.client.from = (table) => {
    const query = originalFrom(table);
    query.maybeSingle = async () => ({ data: { storage_path: path }, error: null });
    return query;
  };
  await app.mount({
    client: app.client, root: app.root, novelId: '42',
    session: { user: { id: app.uid } }, published: false
  });
  assert.equal(app.fields.get('[data-cover-preview]').hidden, false);
  assert.equal(app.fields.get('[data-cover-x-preview]').hidden, true);
});
