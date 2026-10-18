import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [
  settingsScript,
  settingsCss,
  continuity,
  episode,
  seoEpisode,
  illustrationCss
] = await Promise.all([
  readFile('novelight-reading-settings.js', 'utf8'),
  readFile('novelight-reading-settings.css', 'utf8'),
  readFile('novelight-reading-continuity.js', 'utf8'),
  readFile('episode.html', 'utf8'),
  readFile('api/seo/templates/episode.html', 'utf8'),
  readFile('novelight-episode-illustrations.css', 'utf8')
]);

function readerSettings() {
  const values = new Map();
  const document = {
    body: {
      dataset: {},
      style: { setProperty() {} }
    }
  };
  const window = {
    document,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    scrollY: 0,
    innerHeight: 600,
    scrollTo() {}
  };
  vm.runInNewContext(settingsScript, { window, document, console });
  return { api: window.NovelightReadingSettings, document, values };
}

test('old reader settings default safely to horizontal and persist vertical mode', () => {
  const { api, document, values } = readerSettings();
  assert.equal(api.normalize({ fontSize: 'large' }).writingMode, 'horizontal');
  assert.equal(
    api.normalize({ writingMode: 'unexpected' }).writingMode,
    'horizontal'
  );
  const configured = api.apply({
    ...api.DEFAULTS,
    writingMode: 'vertical'
  });
  assert.equal(document.body.dataset.readingDirection, 'vertical');
  api.save(configured);
  assert.equal(api.load().writingMode, 'vertical');
  assert.equal(
    JSON.parse(values.get(api.STORAGE_KEY)).writingMode,
    'vertical'
  );
  api.apply(api.DEFAULTS);
  assert.equal(document.body.dataset.readingDirection, 'horizontal');
});

test('vertical progress uses the horizontal reading axis and restores right-to-left scroll', () => {
  const { api } = readerSettings();
  api.apply({ ...api.DEFAULTS, writingMode: 'vertical' });
  let scrollRequest;
  const content = {
    scrollWidth: 2000,
    clientWidth: 400,
    scrollLeft: -800,
    scrollTo: (options) => {
      scrollRequest = options;
    }
  };
  assert.equal(api.contentProgress(content), 0.6);
  api.seekProgress(content, 0.6, 'smooth');
  assert.equal(scrollRequest.left, -1060);
  assert.equal(scrollRequest.behavior, 'smooth');
  content.scrollLeft = -1600;
  assert.equal(api.contentProgress(content), 1);
});

test('vertical mode keeps illustrations upright and inside the reader viewport', () => {
  assert.match(settingsCss, /writing-mode: vertical-rl/);
  assert.match(settingsCss, /text-orientation: mixed/);
  assert.match(settingsCss, /overflow-x: auto/);
  assert.match(settingsCss, /\.content > \.episode-inline-illustration/);
  assert.match(settingsCss, /writing-mode: horizontal-tb/);
  assert.match(settingsCss, /max-width: 100%/);
  assert.match(settingsCss, /max-height: 100%/);
  assert.match(settingsCss, /object-fit: contain/);
  assert.match(illustrationCss, /\.episode-inline-illustration img/);
});

test('both episode entry points count horizontal scrolling as real reading', () => {
  for (const html of [episode, seoEpisode]) {
    assert.match(html, /NovelightReadingSettings\?\.contentProgress/);
    assert.match(html, /scrollContainer\?\.addEventListener/);
    assert.match(html, /scrollContainer\?\.removeEventListener/);
    assert.match(html, /NovelightEpisodeIllustrations\.mountReader/);
  }
  assert.match(continuity, /NovelightReadingSettings\?\.contentProgress/);
  assert.match(continuity, /NovelightReadingSettings\?\.seekProgress/);
  assert.match(continuity, /content\.addEventListener\('scroll', schedule/);
  assert.match(continuity, /novelight-reading-mode-changed/);
});
