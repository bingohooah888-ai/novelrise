import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../novelight-author-backgrounds.js', import.meta.url),
  'utf8'
);

function load(initialValue, storageError = false) {
  const listeners = new Map();
  const values = new Map(
    initialValue === null || initialValue === undefined
      ? []
      : [['novelight_author_background', initialValue]]
  );
  const window = {
    localStorage: {
      getItem(key) {
        if (storageError) throw new Error('blocked');
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageError) throw new Error('blocked');
        values.set(key, value);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(source, { window, document });
  return { window, document, listeners, values };
}

test('decorative is the default and unknown stored values are ignored', () => {
  assert.equal(
    load(null).document.documentElement.dataset.authorBackground,
    'decorative'
  );
  assert.equal(
    load('unknown').document.documentElement.dataset.authorBackground,
    'decorative'
  );
});

test('simple mode applies immediately and persists only the allowlisted value', () => {
  const state = load('decorative');
  assert.equal(state.window.NovelightAuthorBackground.set('simple'), true);
  assert.equal(
    state.document.documentElement.dataset.authorBackground,
    'simple'
  );
  assert.equal(state.values.get('novelight_author_background'), 'simple');
  state.window.NovelightAuthorBackground.set('invalid');
  assert.equal(
    state.document.documentElement.dataset.authorBackground,
    'decorative'
  );
});

test('blocked storage keeps a safe decorative default and still permits preview', () => {
  const state = load(null, true);
  assert.equal(
    state.document.documentElement.dataset.authorBackground,
    'decorative'
  );
  assert.equal(state.window.NovelightAuthorBackground.set('simple'), false);
  assert.equal(
    state.document.documentElement.dataset.authorBackground,
    'simple'
  );
});
