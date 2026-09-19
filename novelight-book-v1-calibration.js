(() => {
  'use strict';

  const CANVAS_WIDTH = 1086;
  const CANVAS_HEIGHT = 1448;
  const TEMPLATE_KEY = 'book-v1';
  const REFERENCE_ASSET_URL =
    'assets/thumbnail-templates/book-v1/admin-reference.webp';
  const INITIAL_COVER_QUAD = Object.freeze({
    top_left: Object.freeze({ x: 114, y: 287 }),
    top_right: Object.freeze({ x: 701, y: 176 }),
    bottom_right: Object.freeze({ x: 1067, y: 946 }),
    bottom_left: Object.freeze({ x: 356, y: 1147 })
  });

  function cloneQuad(quad = INITIAL_COVER_QUAD) {
    return {
      top_left: { ...quad.top_left },
      top_right: { ...quad.top_right },
      bottom_right: { ...quad.bottom_right },
      bottom_left: { ...quad.bottom_left }
    };
  }

  function storedQuadFromTemplate(template) {
    if (!template) return null;
    const quad = {
      top_left: {
        x: Number(template.cover_top_left_x),
        y: Number(template.cover_top_left_y)
      },
      top_right: {
        x: Number(template.cover_top_right_x),
        y: Number(template.cover_top_right_y)
      },
      bottom_right: {
        x: Number(template.cover_bottom_right_x),
        y: Number(template.cover_bottom_right_y)
      },
      bottom_left: {
        x: Number(template.cover_bottom_left_x),
        y: Number(template.cover_bottom_left_y)
      }
    };
    return Object.values(quad).every(
      (point) => Number.isInteger(point.x) && Number.isInteger(point.y)
    )
      ? quad
      : null;
  }

  window.NovelightBookV1Calibration = Object.freeze({
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    TEMPLATE_KEY,
    REFERENCE_ASSET_URL,
    INITIAL_COVER_QUAD,
    cloneQuad,
    storedQuadFromTemplate
  });
})();
