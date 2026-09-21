import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { resolveAllowedPath } from "./security.js";

export async function fileInfo(inputPath, config) {
  const absolute = resolveAllowedPath(inputPath, config);
  const stat = await fs.stat(absolute);
  return { path: absolute, type: stat.isDirectory() ? "directory" : "file", size: stat.size, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString() };
}

export async function hashFile(inputPath, algorithm, config) {
  const absolute = resolveAllowedPath(inputPath, config);
  const data = await fs.readFile(absolute);
  return { path: absolute, algorithm, hash: crypto.createHash(algorithm).update(data).digest("hex"), size: data.length };
}

function wildcardRegex(pattern) {
  const escaped = String(pattern || "*").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$", "i");
}

export async function searchFiles(directory, options, config) {
  const root = resolveAllowedPath(directory, config);
  const nameRe = wildcardRegex(options.pattern || "*");
  const contentNeedle = options.content ? String(options.content) : null;
  const results = [];
  const maxResults = Math.max(1, Math.min(1000, Number(options.maxResults || 200)));
  async function walk(current, depth) {
    if (results.length >= maxResults || depth > (options.depth || 6)) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(absolute, depth + 1); continue; }
      if (!nameRe.test(entry.name)) continue;
      if (contentNeedle) {
        const stat = await fs.stat(absolute);
        if (stat.size > 2_000_000) continue;
        let text;
        try { text = await fs.readFile(absolute, "utf8"); } catch { continue; }
        const haystack = options.caseSensitive ? text : text.toLowerCase();
        const needle = options.caseSensitive ? contentNeedle : contentNeedle.toLowerCase();
        const index = haystack.indexOf(needle);
        if (index < 0) continue;
        results.push({ path: path.relative(config.primary, absolute), matchIndex: index, excerpt: text.slice(Math.max(0, index - 120), index + needle.length + 240) });
      } else {
        const stat = await fs.stat(absolute);
        results.push({ path: path.relative(config.primary, absolute), size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    }
  }
  await walk(root, 1);
  return results;
}

export async function copyFile(source, destination, config) {
  const src = resolveAllowedPath(source, config);
  const dst = resolveAllowedPath(destination, config);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
  return { source: src, destination: dst };
}

export async function moveFile(source, destination, config) {
  const src = resolveAllowedPath(source, config);
  const dst = resolveAllowedPath(destination, config);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return { source: src, destination: dst };
}

export async function makeDirectory(directory, config) {
  const absolute = resolveAllowedPath(directory, config);
  await fs.mkdir(absolute, { recursive: true });
  return { directory: absolute };
}

export async function deletePath(inputPath, config) {
  if (!config.allowDestructive) throw new Error("Delete is disabled until NOVELIGHT_COMMANDER_ALLOW_DESTRUCTIVE=true.");
  const absolute = resolveAllowedPath(inputPath, config);
  if (absolute === config.primary || config.roots.includes(absolute)) throw new Error("Refusing to delete an allowed root.");
  await fs.rm(absolute, { recursive: true, force: false });
  return { deleted: absolute };
}

export async function inspectPng(inputPath, config) {
  const absolute = resolveAllowedPath(inputPath, config);
  const data = await fs.readFile(absolute);
  const png = PNG.sync.read(data);
  let transparentPixels = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < 255) transparentPixels += 1;
  return { path: absolute, width: png.width, height: png.height, transparentPixels, hasTransparency: transparentPixels > 0, fullyTransparentPixels: (() => { let n = 0; for (let i = 3; i < png.data.length; i += 4) if (png.data[i] === 0) n += 1; return n; })() };
}
