import { Blob } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

const mediaShare = await readFile(
  new URL('../novelight-x-image-share.js', import.meta.url),
  'utf8'
);
const workDetail = await readFile(
  new URL('../novelight-novel-detail.js', import.meta.url),
  'utf8'
);

test('X media sharing prioritizes author and published work covers', () => {
  assert.match(mediaShare, /novel_thumbnail_assets/u);
  assert.match(mediaShare, /add\(asset\.data\?\.image_url\)/u);
  assert.match(mediaShare, /add\(novel\.thumbnail_url\)/u);
  assert.match(mediaShare, /add\(row\?\.render_url\)/u);
});

test('NOVELIGHT default image replaces missing or unreadable covers', () => {
  assert.match(mediaShare, /defaultCoverPng/u);
  assert.match(mediaShare, /#071221/u);
  assert.match(mediaShare, /NOVELIGHT/u);
  assert.match(mediaShare, /catch \(error\)/u);
});

test('mobile Web Share includes image, title, and URL', () => {
  assert.match(mediaShare, /navigator\.canShare/u);
  assert.match(mediaShare, /navigator\.share\(payload\)/u);
  assert.match(mediaShare, /files: \[file\]/u);
});

test('desktop image clipboard and X composer work together', () => {
  assert.match(mediaShare, /navigator\.clipboard\.write/u);
  assert.match(mediaShare, /new ClipboardItem/u);
  assert.ok(
    mediaShare.indexOf('copyResult = navigator.clipboard.write') <
      mediaShare.indexOf("const popup = window.open('about:blank', '_blank')")
  );
  assert.match(mediaShare, /popup\.location\.replace/u);
  assert.match(mediaShare, /downloadFile\(file\)/u);
});

test('work detail X button delegates to the image share runtime', () => {
  assert.match(workDetail, /NovelightXImageShare\.share/u);
  assert.match(workDetail, /event\.preventDefault\(\)/u);
});

test('Windows Chrome uses X intent rather than native OS sharing', async () => {
  let nativeShares = 0;
  let xIntent = '';
  let directIntent = '';
  let copyCount = 0;
  const canvasContext = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    strokeRect() {},
    fillText() {}
  };
  const window = {
    ClipboardItem: true,
    open: (url) => {
      if (url !== 'about:blank') directIntent = url;
      return {
        closed: false,
        opener: null,
        location: {
          replace(nextUrl) {
            xIntent = nextUrl;
          }
        }
      };
    }
  };
  const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154',
    userAgentData: { mobile: false },
    canShare: () => true,
    share: async () => {
      nativeShares += 1;
    },
    clipboard: {
      write: async () => {
        copyCount += 1;
      }
    }
  };
  runInNewContext(mediaShare, {
    window,
    navigator,
    URL,
    Blob,
    File: class {
      constructor(parts, name, { type }) {
        this.parts = parts;
        this.name = name;
        this.type = type;
      }
    },
    ClipboardItem: class {
      constructor(data) {
        this.data = data;
      }
    },
    document: {
      createElement: () => ({
        getContext: () => canvasContext,
        toBlob: (done) => done(new Blob(['png'], { type: 'image/png' }))
      })
    },
    console: { warn() {} }
  });
  // The first desktop click must open X without waiting for the PNG.
  await window.NovelightXImageShare.share({
    novelId: '354',
    title: '作品タイトル',
    url: 'https://novelight.jp/novel.html?id=354'
  });
  assert.match(directIntent, /twitter\.com\/intent\/tweet/u);
  assert.equal(copyCount, 0);

  await window.NovelightXImageShare.prepare('354').promise;
  await window.NovelightXImageShare.share({
    novelId: '354',
    title: '作品タイトル',
    url: 'https://novelight.jp/novel.html?id=354'
  });
  assert.equal(nativeShares, 0);
  assert.equal(copyCount, 1);
  const sharedUrl = new URL(new URL(xIntent).searchParams.get('url'));
  assert.equal(sharedUrl.origin, 'https://novelight.jp');
  assert.equal(sharedUrl.pathname, '/novel.html');
  assert.equal(sharedUrl.searchParams.get('id'), '354');
  assert.equal(sharedUrl.searchParams.get('x_card'), 'png-v3');
});
