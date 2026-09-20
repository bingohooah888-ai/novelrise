(function (global) {
  'use strict';

  const encoder = new TextEncoder();
  let crcTable = null;

  function table() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    const values = table();
    for (const byte of bytes) crc = values[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function u32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function dosTime(date) {
    return (
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2) || 0) & 0x1f)
    );
  }

  function dosDate(date) {
    const year = Math.max(1980, date.getFullYear());
    return (
      (((year - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f)
    );
  }

  async function bytesFor(value) {
    if (typeof value === 'string') return encoder.encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    throw new TypeError('Unsupported ZIP file payload');
  }

  function safeName(value) {
    const name = String(value || '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
    if (!name || name.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Invalid ZIP file name');
    }
    return name;
  }

  async function createZip(files, modifiedAt = new Date()) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 5000) {
      throw new Error('Invalid ZIP file set');
    }

    const chunks = [];
    const central = [];
    let offset = 0;
    const time = dosTime(modifiedAt);
    const date = dosDate(modifiedAt);

    for (const file of files) {
      const name = safeName(file.name);
      const nameBytes = encoder.encode(name);
      const data = await bytesFor(file.data);
      const crc = crc32(data);

      const local = new Uint8Array(30);
      const localView = new DataView(local.buffer);
      u32(localView, 0, 0x04034b50);
      u16(localView, 4, 20);
      u16(localView, 6, 0x0800);
      u16(localView, 8, 0);
      u16(localView, 10, time);
      u16(localView, 12, date);
      u32(localView, 14, crc);
      u32(localView, 18, data.length);
      u32(localView, 22, data.length);
      u16(localView, 26, nameBytes.length);
      u16(localView, 28, 0);
      chunks.push(local, nameBytes, data);

      const directory = new Uint8Array(46);
      const directoryView = new DataView(directory.buffer);
      u32(directoryView, 0, 0x02014b50);
      u16(directoryView, 4, 20);
      u16(directoryView, 6, 20);
      u16(directoryView, 8, 0x0800);
      u16(directoryView, 10, 0);
      u16(directoryView, 12, time);
      u16(directoryView, 14, date);
      u32(directoryView, 16, crc);
      u32(directoryView, 20, data.length);
      u32(directoryView, 24, data.length);
      u16(directoryView, 28, nameBytes.length);
      u16(directoryView, 30, 0);
      u16(directoryView, 32, 0);
      u16(directoryView, 34, 0);
      u16(directoryView, 36, 0);
      u32(directoryView, 38, 0);
      u32(directoryView, 42, offset);
      central.push(directory, nameBytes);
      offset += local.length + nameBytes.length + data.length;
    }

    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    u32(endView, 0, 0x06054b50);
    u16(endView, 4, 0);
    u16(endView, 6, 0);
    u16(endView, 8, files.length);
    u16(endView, 10, files.length);
    u32(endView, 12, centralSize);
    u32(endView, 16, offset);
    u16(endView, 20, 0);

    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  global.NovelightZip = Object.freeze({ createZip, crc32, safeName });
})(typeof window === 'undefined' ? globalThis : window);
