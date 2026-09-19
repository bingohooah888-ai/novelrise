import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export function normalizeEol(text) {
  return text.replace(/\r\n?/gu, '\n');
}

export async function readText(path, encoding = 'utf8') {
  return normalizeEol(await readFile(path, encoding));
}

export function readTextSync(path, encoding = 'utf8') {
  return normalizeEol(readFileSync(path, encoding));
}
