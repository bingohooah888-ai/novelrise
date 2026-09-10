import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function point(value, name, width, height) {
  if (!value || typeof value !== 'object')
    throw new Error(`${name} is required`);
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`${name} must use integer coordinates`);
  }
  if (x < 0 || x > width || y < 0 || y > height) {
    throw new Error(`${name} is outside the template canvas`);
  }
  return { x, y };
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

export function normalizeCoverQuad(rawQuad, width = 1086, height = 1448) {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1
  ) {
    throw new Error('Invalid template canvas');
  }
  const quad = {
    top_left: point(rawQuad?.top_left, 'top_left', width, height),
    top_right: point(rawQuad?.top_right, 'top_right', width, height),
    bottom_right: point(rawQuad?.bottom_right, 'bottom_right', width, height),
    bottom_left: point(rawQuad?.bottom_left, 'bottom_left', width, height)
  };
  const points = [
    quad.top_left,
    quad.top_right,
    quad.bottom_right,
    quad.bottom_left
  ];
  if (
    quad.top_left.x >= quad.top_right.x ||
    quad.bottom_left.x >= quad.bottom_right.x
  ) {
    throw new Error('Cover quad left/right ordering is invalid');
  }
  if (
    quad.top_left.y >= quad.bottom_left.y ||
    quad.top_right.y >= quad.bottom_right.y
  ) {
    throw new Error('Cover quad top/bottom ordering is invalid');
  }
  const turns = points.map((current, index) =>
    cross(current, points[(index + 1) % 4], points[(index + 2) % 4])
  );
  if (
    turns.some((value) => value === 0) ||
    !turns.every((value) => Math.sign(value) === Math.sign(turns[0]))
  ) {
    throw new Error(
      'Cover quad must be a non-self-intersecting convex quadrilateral'
    );
  }
  if (Math.abs(polygonArea(points)) < 100) {
    throw new Error('Cover quad is too small');
  }
  return quad;
}

function insideConvexQuad(x, y, points, orientation) {
  for (let index = 0; index < points.length; index += 1) {
    const edge = cross(points[index], points[(index + 1) % points.length], {
      x,
      y
    });
    if (orientation > 0 ? edge < 0 : edge > 0) return false;
  }
  return true;
}

export function generateCoverMaskPng(rawQuad, width = 1086, height = 1448) {
  const quad = normalizeCoverQuad(rawQuad, width, height);
  const points = [
    quad.top_left,
    quad.top_right,
    quad.bottom_right,
    quad.bottom_left
  ];
  const orientation = Math.sign(polygonArea(points));
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  const minX = Math.max(
    0,
    Math.floor(Math.min(...points.map((item) => item.x)))
  );
  const maxX = Math.min(
    width - 1,
    Math.ceil(Math.max(...points.map((item) => item.x)))
  );
  const minY = Math.max(
    0,
    Math.floor(Math.min(...points.map((item) => item.y)))
  );
  const maxY = Math.min(
    height - 1,
    Math.ceil(Math.max(...points.map((item) => item.y)))
  );

  for (let y = minY; y <= maxY; y += 1) {
    const rowOffset = y * stride;
    for (let x = minX; x <= maxX; x += 1) {
      if (!insideConvexQuad(x + 0.5, y + 0.5, points, orientation)) continue;
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND')
  ]);
}