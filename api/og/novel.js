import { methodAllowed, queryValue } from '../seo/public-page.js';
import {
  OG_COVER_WIDTH,
  OG_HEIGHT,
  OG_WIDTH,
  loadNovelOgData
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

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf
      ].includes(marker)
    ) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3)
      };
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const type = bytes.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (type === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff)
    };
  }
  if (
    type === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
}

function imageSize(bytes) {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes.toString('ascii', 1, 4) === 'PNG'
  ) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }
  return jpegSize(bytes) || webpSize(bytes);
}

async function chooseImageFit(data) {
  if (data.coverSource !== 'author' || !data.coverUrl) return 'cover';

  try {
    const response = await globalThis.fetch(data.coverUrl, {
      headers: { Range: 'bytes=0-65535' },
      signal: globalThis.AbortSignal.timeout(2200)
    });
    if (!response.ok && response.status !== 206) return 'cover';
    const bytes = Buffer.from(await response.arrayBuffer());
    const size = imageSize(bytes);
    if (!size?.width || !size?.height) return 'cover';
    return size.width / size.height > 1.05 ? 'contain' : 'cover';
  } catch {
    return 'cover';
  }
}

function sendImageHeaders(res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', CACHE_HEADER);
  res.setHeader('X-Content-Type-Options', 'nosniff');
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

    const imageFit = await chooseImageFit(data);
    const { ImageResponse } = await import('@vercel/og');
    const image = new ImageResponse(buildNovelOgElement(data, { imageFit }), {
      width: OG_WIDTH,
      height: OG_HEIGHT
    });
    const buffer = Buffer.from(await image.arrayBuffer());
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Novel OGP render failed', {
      code: error?.code || null,
      message: error?.message || null
    });
    return res.status(503).send('OG image temporarily unavailable');
  }
}
