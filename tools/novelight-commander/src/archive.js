import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { resolveAllowedPath } from "./security.js";

function safeZipName(name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Unsafe ZIP entry path: " + name);
  return normalized;
}

function pngHeader(buffer) {
  const sig = [137,80,78,71,13,10,26,10];
  if (buffer.length < 33 || sig.some((v,i) => buffer[i] !== v)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bitDepth: buffer[24], colorType: buffer[25] };
}

export async function listZip(inputPath, config) {
  const absolute = resolveAllowedPath(inputPath, config);
  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  const entries = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    entries.push({ name, directory: entry.dir, unsafe: (() => { try { safeZipName(name); return false; } catch { return true; } })() });
  }
  return { path: absolute, count: entries.length, entries };
}

export async function extractZip(inputPath, destination, config) {
  const absolute = resolveAllowedPath(inputPath, config);
  const dest = resolveAllowedPath(destination, config);
  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  const extracted = [];
  for (const [rawName, entry] of Object.entries(zip.files)) {
    const name = safeZipName(rawName);
    const target = path.resolve(dest, name);
    const relative = path.relative(dest, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("ZIP traversal blocked: " + name);
    if (entry.dir) { await fs.mkdir(target, { recursive: true }); continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async("nodebuffer"));
    extracted.push(path.relative(config.primary, target));
  }
  return { destination: dest, files: extracted.length, extracted };
}

export async function createZip(outputPath, inputPaths, config) {
  const output = resolveAllowedPath(outputPath, config);
  const zip = new JSZip();
  for (const input of inputPaths) {
    const absolute = resolveAllowedPath(input, config);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("Only files are supported by create_zip: " + input);
    zip.file(path.basename(absolute), await fs.readFile(absolute));
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  return { output, files: inputPaths.length };
}

export async function validateThumbnailPack(zipPath, manifestPath, config) {
  const absolute = resolveAllowedPath(zipPath, config);
  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  let manifest;
  if (manifestPath) {
    manifest = JSON.parse(await fs.readFile(resolveAllowedPath(manifestPath, config), "utf8"));
  } else {
    const entry = zip.file("manifest.json");
    if (!entry) throw new Error("manifest.json not found in ZIP and no manifestPath supplied.");
    manifest = JSON.parse(await entry.async("string"));
  }
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (!items.length) throw new Error("Manifest has no items.");
  const results = [];
  for (const item of items) {
    const entryName = safeZipName(item.path || ("images/" + item.key + ".png"));
    const entry = zip.file(entryName);
    if (!entry) { results.push({ key: item.key, path: entryName, ok: false, error: "missing" }); continue; }
    const bytes = await entry.async("nodebuffer");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const png = pngHeader(bytes);
    const errors = [];
    if (item.size != null && Number(item.size) !== bytes.length) errors.push("size");
    if (item.sha256 && String(item.sha256).toLowerCase() !== sha256) errors.push("sha256");
    if (png) {
      if (item.width != null && Number(item.width) !== png.width) errors.push("width");
      if (item.height != null && Number(item.height) !== png.height) errors.push("height");
      if (item.bitDepth != null && Number(item.bitDepth) !== png.bitDepth) errors.push("bitDepth");
      if (item.colorType != null && Number(item.colorType) !== png.colorType) errors.push("colorType");
    } else if (entryName.toLowerCase().endsWith(".png")) errors.push("png");
    results.push({ key: item.key, path: entryName, ok: errors.length === 0, errors, size: bytes.length, sha256, png });
  }
  const failed = results.filter(item => !item.ok);
  return { packKey: manifest.packKey || null, expected: items.length, checked: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0, results };
}

export async function readEmbeddedThumbnailManifest(zipPath, config) {
  const absolute = resolveAllowedPath(zipPath, config);
  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  const entry = zip.file("manifest.json");
  return entry ? JSON.parse(await entry.async("string")) : null;
}
