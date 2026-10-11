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

test('every device opens the same X link card without attaching media', () => {
  const shareStart = mediaShare.indexOf('  async function share(');
  const shareBody = mediaShare.slice(shareStart);
  assert.match(shareBody, /window\.open\(intent, '_blank'\)/u);
  assert.match(shareBody, /void warm\(url\)/u);
  assert.doesNotMatch(shareBody, /navigator\.share/u);
  assert.doesNotMatch(shareBody, /navigator\.clipboard/u);
  assert.doesNotMatch(shareBody, /prepare\(novelId\)/u);
  assert.doesNotMatch(shareBody, /about:blank/u);
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
    querySelector: () => ({
      remove: () => {
        notes.length = 0;
      }
    }),
    appendChild: (note) => {
      notes.push(note);
    }
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
  // The first click opens X while the public metadata fetch is unresolved.
  const initialShare = window.NovelightXImageShare.share({
    novelId: '354',
    title: '作品タイトル',
    url: 'https://novelight.jp/novel.html?id=354'
  });
  assert.match(directIntent, /twitter\.com\/intent\/tweet/u);
  assert.equal(xIntent, '');
  assert.equal(copyCount, 0);
  assert.equal(openedTabs, 1);
  assert.equal(publicCardChecks, 1);
  releaseMetadata();
  await initialShare;

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
  assert.equal(publicCardChecks, 1);
  const sharedUrl = new URL(new URL(directIntent).searchParams.get('url'));
  assert.equal(sharedUrl.origin, 'https://novelight.jp');
  assert.equal(sharedUrl.pathname, '/novel.html');
  assert.equal(sharedUrl.searchParams.get('id'), '354');
  assert.equal(sharedUrl.searchParams.get('x_card'), 'png-v5-mincho');

  // Episode links must retain the chapter URL and bust pre-OGP X cache.
  await window.NovelightXImageShare.share({
    novelId: '354',
    title: '第123話　家族は宝物',
    url: 'https://novelight.jp/episode.html?id=3420'
  });
  const episodeUrl = new URL(new URL(directIntent).searchParams.get('url'));
  assert.equal(episodeUrl.pathname, '/episode.html');
  assert.equal(episodeUrl.searchParams.get('id'), '3420');
  assert.equal(episodeUrl.searchParams.get('x_card'), 'episode-png-v4-fast');
  assert.equal(copyCount, 0);
  assert.equal(openedTabs, 3);
  assert.equal(publicCardChecks, 2);
});

test('iOS and Android share the clickable card on the first tap', async () => {
  for (const userAgent of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9)'
  ]) {
    let openCount = 0;
    let fileShareCount = 0;
    let nativeShareCount = 0;
    let clipboardWrites = 0;
    let canvasCreates = 0;
    let lastIntent = '';
    let finishMetadata;
    const metadataGate = new Promise((resolve) => {
      finishMetadata = resolve;
    });
    const window = {
      setTimeout: () => 1,
      clearTimeout() {},
      location: {
        assign(url) {
          lastIntent = url;
        }
      },
      open(url) {
        openCount += 1;
        lastIntent = url;
        return { opener: null };
      }
    };
    const navigator = {
      userAgent,
      userAgentData: { mobile: true },
      canShare: () => {
        fileShareCount += 1;
        return true;
      },
      share: async () => {
        nativeShareCount += 1;
      },
      clipboard: {
        write: async () => {
          clipboardWrites += 1;
        }
      }
    };
    runInNewContext(mediaShare, {
      window,
      navigator,
      URL,
      AbortSignal: { timeout: () => null },
      fetch: async () => {
        await metadataGate;
        return {
          ok: true,
          text: async () =>
            '<meta name="twitter:image" content="https://novelight.jp/card.png">'
        };
      },
      Image: class {
        set src(_url) {
          Promise.resolve().then(() => this.onload?.());
        }
      },
      document: {
        createElement() {
          canvasCreates += 1;
          throw new Error('X link cards must not create image attachments');
        }
      },
      console: { warn() {} }
    });
    // Image metadata is still pending when the first mobile tap opens X.
    const first = window.NovelightXImageShare.share({
      novelId: '257',
      title: '物語タイトル',
      url: 'https://novelight.jp/novel.html?id=257'
    });
    assert.equal(openCount, 1);
    assert.match(lastIntent, /twitter\.com\/intent\/tweet/u);
    const novelUrl = new URL(new URL(lastIntent).searchParams.get('url'));
    assert.equal(novelUrl.pathname, '/novel.html');
    assert.equal(novelUrl.searchParams.get('id'), '257');
    assert.equal(novelUrl.searchParams.get('x_card'), 'png-v5-mincho');
    finishMetadata();
    await first;

    await window.NovelightXImageShare.share({
      novelId: '257',
      title: '第123話',
      url: 'https://novelight.jp/episode.html?id=3420'
    });
    const episodeUrl = new URL(new URL(lastIntent).searchParams.get('url'));
    assert.equal(openCount, 2);
    assert.equal(episodeUrl.pathname, '/episode.html');
    assert.equal(episodeUrl.searchParams.get('id'), '3420');
    assert.equal(episodeUrl.searchParams.get('x_card'), 'episode-png-v4-fast');
    assert.equal(nativeShareCount, 0);
    assert.equal(fileShareCount, 0);
    assert.equal(clipboardWrites, 0);
    assert.equal(canvasCreates, 0);
  }
});
