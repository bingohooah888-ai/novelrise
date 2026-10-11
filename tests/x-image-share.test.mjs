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
      mediaShare.lastIndexOf(
        "const popup = window.open('about:blank', '_blank')"
      )
  );
  assert.match(mediaShare, /popup\.location\.replace/u);
  assert.match(mediaShare, /downloadFile\(file\)/u);
});

test('work detail X button delegates to the image share runtime', () => {
  assert.match(workDetail, /NovelightXImageShare\.share/u);
  assert.match(workDetail, /event\.preventDefault\(\)/u);
});

test('work detail only shows actionable X share errors, not success tips', () => {
  const start = workDetail.indexOf('onStatus: (message) => {');
  const end = workDetail.indexOf('\n        }\n      });', start);
  assert.ok(start >= 0 && end > start);
  const callback = workDetail.slice(
    start + 'onStatus: '.length,
    end + '\n        }'.length
  );
  const notes = [];
  const menu = {
    querySelector: () => ({ remove: () => { notes.length = 0; } }),
    appendChild: (note) => { notes.push(note); }
  };
  const onStatus = runInNewContext(`(${callback})`, {
    menu,
    node: (type, className, text) => ({ type, className, text })
  });
  onStatus('Xで作品URLを投稿すると画像付きリンクカードが表示されます。');
  assert.equal(notes.length, 0);
  onStatus('画像を準備できませんでした。');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, '画像を準備できませんでした。');
});

test('Windows Chrome uses X intent rather than native OS sharing', async () => {
  let nativeShares = 0;
  let xIntent = '';
  let directIntent = '';
  let copyCount = 0;
  let publicCardChecks = 0;
  let openedTabs = 0;
  let releaseMetadata;
  const metadataGate = new Promise((resolve) => {
    releaseMetadata = resolve;
  });
  const canvasContext = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    strokeRect() {},
    fillText() {}
  };
  const window = {
    ClipboardItem: true,
    setTimeout: () => 1,
    clearTimeout: () => {},
    open: (url) => {
      openedTabs += 1;
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
    fetch: async () => {
      publicCardChecks += 1;
      await metadataGate;
      return {
        ok: true,
        text: async () =>
          '<meta name="twitter:image" content="https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders/social-cards/354/0123456789abcdef.png">'
      };
    },
    Image: class {
      set src(_url) {
        Promise.resolve().then(() => this.onload?.());
      }
    },
    AbortSignal: { timeout: () => null },
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
  // First desktop click opens a placeholder but must not navigate to X
  // before the public card page and its PNG are ready.
  const initialShare = window.NovelightXImageShare.share({
    novelId: '354',
    title: '作品タイトル',
    url: 'https://novelight.jp/novel.html?id=354'
  });
  assert.equal(xIntent, '');
  releaseMetadata();
  await initialShare;
  assert.match(xIntent, /twitter\.com\/intent\/tweet/u);
  assert.equal(directIntent, '');
  assert.equal(copyCount, 0);
  assert.equal(openedTabs, 1);
  assert.equal(publicCardChecks, 1);

  await window.NovelightXImageShare.prepare('354').promise;
  await window.NovelightXImageShare.share({
    novelId: '354',
    title: '作品タイトル',
    url: 'https://novelight.jp/novel.html?id=354'
  });
  assert.equal(nativeShares, 0);
  // Previously prepared covers must use the same OG link-card path.
  assert.equal(copyCount, 0);
  assert.equal(openedTabs, 2);
  assert.equal(publicCardChecks, 2);
  const sharedUrl = new URL(new URL(xIntent).searchParams.get('url'));
  assert.equal(sharedUrl.origin, 'https://novelight.jp');
  assert.equal(sharedUrl.pathname, '/novel.html');
  assert.equal(sharedUrl.searchParams.get('id'), '354');
  assert.equal(sharedUrl.searchParams.get('x_card'), 'png-v4-cover');

  // Episode links must retain the chapter URL and bust pre-OGP X cache.
  await window.NovelightXImageShare.share({
    novelId: '354',
    title: '第123話　家族は宝物',
    url: 'https://novelight.jp/episode.html?id=3420'
  });
  const episodeUrl = new URL(new URL(xIntent).searchParams.get('url'));
  assert.equal(episodeUrl.pathname, '/episode.html');
  assert.equal(episodeUrl.searchParams.get('id'), '3420');
  assert.equal(episodeUrl.searchParams.get('x_card'), 'episode-png-v2-cover');
  assert.equal(copyCount, 0);
  assert.equal(openedTabs, 3);
  assert.equal(publicCardChecks, 3);
});
