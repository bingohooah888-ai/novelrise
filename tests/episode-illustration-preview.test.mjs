import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const illustrationJs = fs.readFileSync(
  new URL('../novelight-episode-illustrations.js', import.meta.url),
  'utf8'
);
const episodeHtml = fs.readFileSync(
  new URL('../episode.html', import.meta.url),
  'utf8'
);

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  assert.notEqual(to, -1, `missing source marker: ${end}`);
  return source.slice(from, to);
}

test('public episode illustration rendering stays on the published reader bundle', () => {
  const mountReader = sourceBetween(
    illustrationJs,
    'async function mountReader',
    'async function mountPreview'
  );

  assert.match(mountReader, /action:\s*'reader-list'/);
  assert.doesNotMatch(mountReader, /action:\s*'editor-list'/);
  assert.doesNotMatch(mountReader, /Authorization/);
});

test('authenticated author preview uses the editor bundle and the shared body renderer', () => {
  const mountPreview = sourceBetween(
    illustrationJs,
    'async function mountPreview',
    'global.NovelightEpisodeIllustrations'
  );

  assert.match(mountPreview, /if \(!session\?\.access_token\) return mountReader/);
  assert.match(mountPreview, /action:\s*'editor-list'/);
  assert.match(mountPreview, /renderReaderContent\(root, content, assets/);
  assert.match(mountPreview, /assetsForContent\(data\.assets, content\)/);
});

test('episode page selects private preview only for the signed-in episode author', () => {
  assert.match(
    episodeHtml,
    /isAuthor&&session\?NovelightEpisodeIllustrations\.mountPreview/
  );
  assert.match(
    episodeHtml,
    /:NovelightEpisodeIllustrations\.mountReader/
  );
  assert.match(
    episodeHtml,
    /isAuthor=Boolean\(session&&episode\.user_id===session\.user\.id\)/
  );
});

test('preview filters signed editor assets down to markers referenced by the current body', () => {
  assert.match(illustrationJs, /function referencedIds\(content\)/);
  assert.match(illustrationJs, /function assetsForContent\(assets, content\)/);
  assert.match(
    illustrationJs,
    /filter\(\(asset\) => ids\.has\(String\(asset\?\.id \|\| ''\)\.toLowerCase\(\)\)\)/
  );
});

test('image loading retries through FileReader when blob URL decoding fails', () => {
  const imageFromFile = sourceBetween(
    illustrationJs,
    'async function imageFromFile',
    'function canvasBlob'
  );

  assert.match(imageFromFile, /URL\.createObjectURL\(file\)/);
  assert.match(imageFromFile, /fileAsDataUrl\(file\)/);
  assert.match(illustrationJs, /reader\.readAsDataURL\(file\)/);
});

test('upload failures are classified by processing stage', () => {
  for (const stage of [
    'format',
    'read',
    'decode',
    'convert',
    'prepare',
    'upload',
    'finalize'
  ]) {
    assert.match(illustrationJs, new RegExp(`['"]${stage}['"]`));
  }
  assert.match(illustrationJs, /function uploadFailureMessage\(error\)/);
});

test('upload diagnostics omit credentials, signed paths, filenames, and manuscript content', () => {
  const logger = sourceBetween(
    illustrationJs,
    'function logUploadFailure',
    'async function mountEditor'
  );

  assert.match(logger, /stage:/);
  assert.match(logger, /code:/);
  assert.match(logger, /status:/);
  assert.match(logger, /episodeId:/);
  assert.match(logger, /inputType:/);
  assert.match(logger, /inputBytes:/);
  assert.doesNotMatch(logger, /access_token/);
  assert.doesNotMatch(logger, /prepared\.path/);
  assert.doesNotMatch(logger, /signed/i);
  assert.doesNotMatch(logger, /file\.name/);
  assert.doesNotMatch(logger, /manuscript/i);
});
