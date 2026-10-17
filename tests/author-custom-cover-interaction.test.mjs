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
  const draws = [];
  let removedUrlCount = 0;
  let currentPath = '';
  const bucket = {
    getPublicUrl(path) {
      return { data: { publicUrl: 'https://example.com/' + path } };
    },
    async upload(path, blob, options) {
      events.push({ action: 'upload', path, blob, options });
      return { error: null };
    },
    async remove(paths) {
      events.push({ action: 'remove', paths });
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
        return 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
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
    session: { user: { id: app.uid } }
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
