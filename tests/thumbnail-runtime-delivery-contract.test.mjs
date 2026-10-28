import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const runtimeSource = await readFile(
  new URL('../novelight-thumbnail-runtime.js', import.meta.url),
  'utf8'
);

test('thumbnail runtime rewrites existing story cover images through Vercel optimization', () => {
  assert.match(runtimeSource, /function optimizeExistingImages\(\)/u);
  assert.match(
    runtimeSource,
    /\.novel-cover-image, \.novelight-official-thumbnail img/u
  );
  assert.match(
    runtimeSource,
    /const optimized = optimizedImageUrl\(source\);/u
  );
  assert.match(
    runtimeSource,
    /if \(optimized && optimized !== source\) image\.src = optimized;/u
  );
});

test('thumbnail runtime prioritizes only the above-fold story covers', () => {
  assert.match(runtimeSource, /const ABOVE_FOLD_DESKTOP = 6;/u);
  assert.match(runtimeSource, /const ABOVE_FOLD_MOBILE = 4;/u);
  assert.match(
    runtimeSource,
    /image\.loading = prioritized \? 'eager' : 'lazy';/u
  );
  assert.match(
    runtimeSource,
    /image\.fetchPriority = prioritized \? 'high' : 'low';/u
  );
  assert.match(
    runtimeSource,
    /setImagePriority\(image, index < highPriorityLimit\);/u
  );
});

test('thumbnail runtime skips official hydration for custom covers and cards with existing images', () => {
  assert.match(runtimeSource, /function candidateLinks\(\)/u);
  assert.match(
    runtimeSource,
    /!link\.classList\.contains\('novelight-has-custom-cover'\)/u
  );
  assert.match(runtimeSource, /!link\.querySelector/u);
  assert.match(runtimeSource, /\.community-link img/u);
});
