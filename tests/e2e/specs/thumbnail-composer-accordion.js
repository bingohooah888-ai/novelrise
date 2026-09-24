import { expect, test } from '../fixtures/diagnostic-fixture.js';

const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==';

test('thumbnail composer keeps five material groups in a one-open accordion', async ({
  page
}) => {
  await page.goto('/index.html');
  await page.setContent('<main><div id="composer"></div></main>');
  await page.addStyleTag({ url: '/novelight-thumbnail-composer.css' });
  await page.addScriptTag({ url: '/novelight-thumbnail-composer.js' });

  const ready = await page.evaluate(
    async ({ pixelUrl }) => {
      const templates = [
        {
          template_key: 'book-v1',
          label: '標準本',
          canvas_width: 1086,
          canvas_height: 1448,
          availability_status: 'active',
          cover_mask_source: 'cover_quad',
          cover_mask_revision: 1,
          cover_mask_url: null,
          cover_top_left_x: 100,
          cover_top_left_y: 220,
          cover_top_right_x: 770,
          cover_top_right_y: 98,
          cover_bottom_right_x: 1050,
          cover_bottom_right_y: 997,
          cover_bottom_left_x: 270,
          cover_bottom_left_y: 1178,
          effect_allow_outside_cover: false
        }
      ];
      const assets = [
        { id: 'bg1', label: '背景A', layer_type: 'background' },
        { id: 'book1', label: '基準本A', layer_type: 'base_book' },
        { id: 'cover1', label: '旧cover', layer_type: 'cover' },
        { id: 'pattern1', label: '魔法陣', layer_type: 'pattern' },
        { id: 'symbol1', label: '剣', layer_type: 'symbol' },
        { id: 'frame1', label: '金枠', layer_type: 'frame' },
        { id: 'effect1', label: '旧effect', layer_type: 'effect' }
      ].map((item) => ({
        ...item,
        image_url: pixelUrl,
        template_key: 'book-v1',
        sort_order: 1000,
        availability_status: 'active'
      }));

      const query = (data) => {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          neq() {
            return chain;
          },
          order() {
            return chain;
          },
          then(resolve, reject) {
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
        };
        return chain;
      };
      const client = {
        from(table) {
          if (table === 'novel_thumbnail_templates') return query(templates);
          if (table === 'novel_thumbnail_assets') return query(assets);
          throw new Error(`Unexpected table: ${table}`);
        }
      };

      const result = await globalThis.NovelightThumbnailComposer.mount({
        client,
        root: globalThis.document.getElementById('composer')
      });
      return result.ready;
    },
    { pixelUrl: pixel }
  );

  expect(ready).toBe(true);
  const composer = page.locator('#composer');
  const layers = composer.locator('details.nl-thumb-layer');
  await expect(layers).toHaveCount(5);
  await expect(layers.locator('summary strong')).toHaveText([
    '背景',
    '基準本',
    '背景模様',
    '中央シンボル',
    '枠'
  ]);
  await expect(composer.locator('details.nl-thumb-layer[open]')).toHaveCount(0);
  await expect(layers.first()).not.toHaveAttribute('open', '');

  await layers.nth(1).locator('summary').click();
  await expect(composer.locator('details.nl-thumb-layer[open]')).toHaveCount(1);
  await expect(layers.nth(1)).toHaveAttribute('open', '');
  await expect(layers.first()).not.toHaveAttribute('open', '');

  await layers.nth(2).locator('summary').click();
  await layers
    .nth(2)
    .locator('.nl-thumb-option[data-asset-id="pattern1"]')
    .click();
  await expect(layers.nth(2).locator('.nl-thumb-layer-selection')).toHaveText(
    '魔法陣'
  );

  await expect(
    composer.locator('.nl-thumb-option[data-layer-type="cover"]')
  ).toHaveCount(0);
  await expect(
    composer.locator('.nl-thumb-option[data-layer-type="effect"]')
  ).toHaveCount(0);

  const overflow = await layers
    .nth(2)
    .locator('.nl-thumb-layer-options')
    .evaluate((element) => globalThis.getComputedStyle(element).overflowY);
  expect(overflow).toBe('auto');
  await expect(composer.locator('.nl-thumb-preview-status')).toHaveText(
    'プレビュー',
    { timeout: 20_000 }
  );
});
