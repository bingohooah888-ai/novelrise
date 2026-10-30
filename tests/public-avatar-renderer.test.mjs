import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const script = readFileSync(
  new NodeURL('../novelight-public-avatar.js', import.meta.url),
  'utf8'
);
const owner = '11111111-1111-4111-8111-111111111111';
const path = owner + '/22222222-2222-4222-8222-222222222222.webp';

function renderOn(hostname, client, storedPath = path) {
  let imageSrc = null;
  const holder = {
    isConnected: true,
    dataset: {},
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
    append(...children) {
      this.children.push(...children);
    },
    removeAttribute() {}
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'img');
      return {
        set src(next) {
          imageSrc = next;
          this.onload?.();
        },
        get src() {
          return imageSrc;
        }
      };
    }
  };
  const window = { location: { hostname } };
  runInNewContext(script, { window, document, URL: NodeURL });
  window.NovelightPublicAvatar.paint(holder, storedPath, owner, '読者', client);
  return { holder, imageSrc };
}

test('Production public avatar renders without Storage SDK or client URL', () => {
  const { holder, imageSrc } = renderOn('novelight.jp', {});
  assert.equal(
    imageSrc,
    'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/author-avatars/' +
      path
  );
  assert.equal(holder.dataset.avatarStatus, 'loaded');
  assert.equal(holder.children.length, 1);
  assert.notEqual(holder.children[0], '読');
});

test('non-production public avatar uses its own validated Supabase origin', () => {
  const { holder, imageSrc } = renderOn('localhost', {
    supabaseUrl: 'https://avatar-ci.supabase.co'
  });
  assert.equal(
    imageSrc,
    'https://avatar-ci.supabase.co/storage/v1/object/public/author-avatars/' +
      path
  );
  assert.equal(holder.dataset.avatarStatus, 'loaded');
});

test('non-production does not fall back to Production', () => {
  const { holder, imageSrc } = renderOn('localhost', {});
  assert.equal(imageSrc, null);
  assert.equal(holder.dataset.avatarStatus, 'url-unavailable');
});

test('rejects avatar path not owned by the profile user', () => {
  const pathOfOtherUser =
    '33333333-3333-4333-8333-333333333333/' +
    '22222222-2222-4222-8222-222222222222.webp';
  const { holder, imageSrc } = renderOn('novelight.jp', {}, pathOfOtherUser);
  assert.equal(imageSrc, null);
  assert.deepEqual(holder.children, ['読']);
});
