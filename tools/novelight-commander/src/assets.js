import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PNG } from "pngjs";
import { resolveAllowedPath } from "./security.js";

function header(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || sig.some((v, i) => bytes[i] !== v)) throw new Error("Invalid PNG.");
  return { width:bytes.readUInt32BE(16), height:bytes.readUInt32BE(20), bitDepth:bytes[24], colorType:bytes[25] };
}

function inspectBytes(bytes) {
  const ihdr = header(bytes);
  const png = PNG.sync.read(bytes);
  let partial = 0; let transparent = 0; let centerTransparent = 0; let centerPixels = 0;
  const x1 = Math.floor(png.width * 0.2); const x2 = Math.ceil(png.width * 0.8);
  const y1 = Math.floor(png.height * 0.2); const y2 = Math.ceil(png.height * 0.8);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha < 255) partial += 1;
      if (alpha === 0) transparent += 1;
      if (x >= x1 && x < x2 && y >= y1 && y < y2) { centerPixels += 1; if (alpha === 0) centerTransparent += 1; }
    }
  }
  const pixels = png.width * png.height;
  return { ...ihdr, pixels, alphaPixels:partial, transparentPixels:transparent, alphaRatio:partial / pixels, transparentRatio:transparent / pixels, centerTransparentRatio:centerPixels ? centerTransparent / centerPixels : 0 };
}

export async function validateThumbnailAsset(inputPath, category, config) {
  const absolute = resolveAllowedPath(inputPath,config);
  const bytes = await fs.readFile(absolute);
  const info = inspectBytes(bytes);
  const errors = []; const warnings = [];
  if (info.width !== 1024 || info.height !== 1536) errors.push("dimensions");
  if (info.bitDepth !== 8) errors.push("bitDepth");
  if (category === "background" && info.alphaPixels !== 0) errors.push("background_has_transparency");
  if (["pattern","symbol","frame"].includes(category) && info.alphaPixels === 0) errors.push("transparent_category_is_opaque");
  if (category === "frame" && info.centerTransparentRatio < 0.9) warnings.push("frame_center_not_mostly_transparent");
  if (category === "symbol" && info.transparentRatio < 0.35) warnings.push("symbol_uses_large_canvas_area");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return { file:absolute,category,ok:errors.length === 0,errors,warnings,size:bytes.length,sha256,...info };
}

export async function scanThumbnailDirectory(directory, category, config) {
  const root = resolveAllowedPath(directory,config);
  const entries = (await fs.readdir(root,{withFileTypes:true})).filter(e => e.isFile() && e.name.toLowerCase().endsWith(".png")).sort((a,b) => a.name.localeCompare(b.name));
  const assets = []; const byHash = new Map();
  for (const entry of entries) {
    const result = await validateThumbnailAsset(path.join(root,entry.name),category,config);
    assets.push({ ...result, name:entry.name });
    const list = byHash.get(result.sha256) || []; list.push(entry.name); byHash.set(result.sha256,list);
  }
  const duplicates = [...byHash.entries()].filter(([,names]) => names.length > 1).map(([sha256,names]) => ({sha256,names}));
  return { directory:root,category,count:assets.length,valid:assets.filter(a=>a.ok).length,invalid:assets.filter(a=>!a.ok).length,duplicates,assets };
}

export async function buildThumbnailPack(outputZip, pack, config) {
  if (!pack || !Array.isArray(pack.items) || !pack.items.length) throw new Error("Pack items are required.");
  const zipPath = resolveAllowedPath(outputZip,config);
  const zip = new JSZip();
  const manifest = { schemaVersion:1, packKey:String(pack.packKey || path.basename(zipPath,".zip")), displayName:String(pack.displayName || pack.packKey || "NOVELIGHT official pack"), templateKey:String(pack.templateKey || "book-v1"), expectedPngCount:pack.items.length, items:[] };
  const hashes = new Set();
  for (let i = 0; i < pack.items.length; i += 1) {
    const item = pack.items[i];
    const category = String(item.category || item.layerType || "");
    if (!["background","base_book","pattern","symbol","frame"].includes(category)) throw new Error("Unsupported thumbnail category: " + category);
    const validation = await validateThumbnailAsset(item.file,category,config);
    if (!validation.ok) throw new Error("Thumbnail asset validation failed for " + item.file + ": " + validation.errors.join(","));
    const file = resolveAllowedPath(item.file,config);
    const bytes = await fs.readFile(file);
    const meta = inspectBytes(bytes);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(sha256)) throw new Error("Duplicate exact image in pack: " + item.file);
    hashes.add(sha256);
    const key = String(item.key || path.basename(file,".png"));
    const archivePath = "images/" + key + ".png";
    zip.file(archivePath,bytes);
    manifest.items.push({ key, path:archivePath, label:String(item.label || key), sourceCategory:category, layerType:String(item.layerType || category), templateKey:String(item.templateKey || manifest.templateKey), sortOrder:Number(item.sortOrder ?? 1000 + i * 10), size:bytes.length, sha256, width:meta.width, height:meta.height, bitDepth:meta.bitDepth, colorType:meta.colorType });
  }
  const validation = { status:"PASS", generatedAt:new Date().toISOString(), count:manifest.items.length, duplicateHashes:false };
  zip.file("manifest.json",JSON.stringify(manifest,null,2)+"\n");
  zip.file("VALIDATION.json",JSON.stringify(validation,null,2)+"\n");
  const csv = ["key,label,layer_type,sort_order,size,sha256",...manifest.items.map(item => [item.key,item.label,item.layerType,item.sortOrder,item.size,item.sha256].map(value => "\"" + String(value).replaceAll("\"","\"\"") + "\"").join(","))].join("\n") + "\n";
  zip.file("manifest.csv",csv);
  await fs.mkdir(path.dirname(zipPath),{recursive:true});
  await fs.writeFile(zipPath,await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}}));
  return { zip:zipPath,manifest,validation };
}

function alphaOver(bottom, top) {
  const out = new PNG({width:bottom.width,height:bottom.height});
  for (let i = 0; i < out.data.length; i += 4) {
    const ta = top.data[i+3] / 255; const ba = bottom.data[i+3] / 255; const oa = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c += 1) {
      const tv = top.data[i+c] / 255; const bv = bottom.data[i+c] / 255;
      out.data[i+c] = oa === 0 ? 0 : Math.round(((tv * ta + bv * ba * (1-ta)) / oa) * 255);
    }
    out.data[i+3] = Math.round(oa * 255);
  }
  return out;
}

export async function compositePngLayers(files, output, config) {
  if (!Array.isArray(files) || files.length < 2) throw new Error("At least two PNG layers are required.");
  const decoded = [];
  for (const file of files) decoded.push(PNG.sync.read(await fs.readFile(resolveAllowedPath(file,config))));
  const width = decoded[0].width; const height = decoded[0].height;
  if (decoded.some(p => p.width !== width || p.height !== height)) throw new Error("All PNG layers must have identical dimensions.");
  let result = decoded[0];
  for (let i = 1; i < decoded.length; i += 1) result = alphaOver(result,decoded[i]);
  const target = resolveAllowedPath(output,config);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,PNG.sync.write(result));
  return { output:target,width,height,layers:files.length };
}
