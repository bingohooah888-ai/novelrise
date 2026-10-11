import sharp from 'sharp';

import { methodAllowed, queryValue } from '../seo/public-page.js';
import {
  OG_COVER_WIDTH,
  OG_HEIGHT,
  OG_WIDTH,
  loadNovelOgData,
  safeOgImageUrl
} from './novel-data.js';

const CACHE_HEADER = 'public, max-age=31536000, immutable';

function node(type, props = {}, ...children) {
  const flat = children
    .flat()
    .filter((child) => child !== null && child !== undefined);
  return {
    type,
    props: {
      ...props,
      children: flat.length <= 1 ? (flat[0] ?? null) : flat
    }
  };
}

function truncate(value, limit) {
  const chars = Array.from(String(value || ''));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function fallbackCover() {
  return node(
    'div',
    {
      style: {
        width: `${OG_COVER_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(155deg,#071221 0%,#10243d 58%,#071221 100%)',
        color: '#d6a447'
      }
    },
    node(
      'div',
      {
        style: {
          width: '286px',
          height: '404px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid rgba(214,164,71,.68)',
          borderRadius: '28px',
          background: 'rgba(255,255,255,.025)'
        }
      },
      node(
        'div',
        {
          style: {
            fontSize: '94px',
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: '-6px'
          }
        },
        'N'
      ),
      node(
        'div',
        {
          style: {
            marginTop: '26px',
            fontSize: '21px',
            fontWeight: 800,
            letterSpacing: '5px'
          }
        },
        'NOVELIGHT'
      )
    )
  );
}

function imageCover(url, fit) {
  return node(
    'div',
    {
      style: {
        width: `${OG_COVER_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#071221'
      }
    },
    node('img', {
      src: url,
      width: OG_COVER_WIDTH,
      height: OG_HEIGHT,
      style: {
        width: `${OG_COVER_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        objectFit: fit,
        objectPosition: 'center center'
      }
    })
  );
}

export function buildNovelOgElement(data, { imageFit = 'cover' } = {}) {
  const cover =
    data.coverSource === 'common'
      ? fallbackCover()
      : imageCover(data.coverUrl, imageFit);

  return node(
    'div',
    {
      style: {
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: 'flex',
        background: '#071221',
        color: '#f8f4eb'
      }
    },
    cover,
    node(
      'div',
      {
        style: {
          width: `${OG_WIDTH - OG_COVER_WIDTH}px`,
          height: `${OG_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          padding: '72px 66px 54px',
          borderLeft: '1px solid rgba(214,164,71,.28)',
          background: 'linear-gradient(135deg,#0a1728 0%,#071221 72%)'
        }
      },
      node(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '34px',
            color: '#d6a447',
            fontSize: '18px',
            fontWeight: 800,
            letterSpacing: '4px'
          }
        },
        'NOVELIGHT ORIGINAL'
      ),
      node(
        'div',
        {
          style: {
            display: 'flex',
            maxHeight: '178px',
            overflow: 'hidden',
            fontSize: '52px',
            lineHeight: 1.34,
            fontWeight: 900,
            letterSpacing: '-1px'
          }
        },
        truncate(data.title, 52)
      ),
      node(
        'div',
        {
          style: {
            display: 'flex',
            marginTop: '28px',
            color: '#cbc5b8',
            fontSize: '25px',
            lineHeight: 1.35,
            fontWeight: 600
          }
        },
        truncate(data.authorName, 34)
      ),
      node(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            marginTop: 'auto',
            paddingTop: '30px',
            borderTop: '1px solid rgba(214,164,71,.26)',
            color: '#d6a447',
            fontSize: '24px',
            fontWeight: 900,
            letterSpacing: '6px'
          }
        },
        'NOVELIGHT'
      )
    )
  );
}

const MAX_COVER_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_COVER_PNG_BYTES = 5 * 1024 * 1024;

// Satori (@vercel/og) may silently omit WebP covers. Decode them before
// composing the social card; never persist a full-size PNG with a blank cover.
export async function prepareNovelOgCover(
  data,
  { fetchImage = globalThis.fetch, imageProcessor = sharp } = {}
) {
  if (data.coverSource === 'common' || !data.coverUrl) return data;

  const trustedUrl = safeOgImageUrl(data.coverUrl);
  if (!trustedUrl) throw new Error('Social card cover URL is not trusted');

  const response = await fetchImage(trustedUrl, {
    signal: globalThis.AbortSignal.timeout(6500)
  });
  if (!response.ok) {
    throw new Error(`Social card cover fetch failed: ${response.status}`);
  }
  const declaredBytes = Number(response.headers?.get?.('content-length'));
  if (declaredBytes > MAX_COVER_SOURCE_BYTES) {
    throw new Error('Social card cover exceeds input size limit');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_COVER_SOURCE_BYTES) {
    throw new Error('Social card cover exceeds input size limit');
  }

  // Convert every cover to a real PNG before it reaches ImageResponse.
  // "contain" preserves the complete user-selected vertical cover artwork.
  const png = await imageProcessor(bytes, { limitInputPixels: 20_000_000 })
    .resize({
      width: OG_COVER_WIDTH,
      height: OG_HEIGHT,
      fit: 'contain',
      background: '#071221'
    })
    .png()
    .toBuffer();
  if (
    png.length < 24 ||
    png.length > MAX_COVER_PNG_BYTES ||
    png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
    png.readUInt32BE(16) !== OG_COVER_WIDTH ||
    png.readUInt32BE(20) !== OG_HEIGHT
  ) {
    throw new Error('Social card cover PNG conversion failed');
  }

  return {
    ...data,
    coverUrl: `data:image/png;base64,${png.toString('base64')}`
  };
}

function sendImageHeaders(res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', CACHE_HEADER);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// Shared with the persistent X/OG social-card cache so its PNG pixels
// always match the existing 1200x630 NOVELIGHT image design.
export async function renderNovelOgPng(data) {
  const prepared = await prepareNovelOgCover(data);
  const { ImageResponse } = await import('@vercel/og');
  const image = new ImageResponse(
    buildNovelOgElement(prepared, { imageFit: 'contain' }),
    { width: OG_WIDTH, height: OG_HEIGHT }
  );
  return Buffer.from(await image.arrayBuffer());
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res)) return;

  const id = queryValue(req.query?.id);
  if (!/^\d+$/u.test(id)) {
    return res.status(404).send('OG image not found');
  }

  try {
    const data = await loadNovelOgData(id);
    if (!data) return res.status(404).send('OG image not found');

    sendImageHeaders(res);
    if (req.method === 'HEAD') return res.status(200).end();

    return res.status(200).send(await renderNovelOgPng(data));
  } catch (error) {
    console.error('Novel OGP render failed', {
      code: error?.code || null,
      message: error?.message || null
    });
    return res.status(503).send('OG image temporarily unavailable');
  }
}
