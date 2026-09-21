import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readNovel } from "./novel.js";
import { resolveAllowedPath } from "./security.js";

function cacheKey(url) { return crypto.createHash("sha256").update(String(url)).digest("hex"); }

function cachePath(url, config) {
  return resolveAllowedPath(path.join(config.cacheDir, "novels", cacheKey(url) + ".json"), config);
}

export async function readNovelCached(url, options, config) {
  const file = cachePath(url, config);
  let cached = null;
  try { cached = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const cachedEpisodes = Object.fromEntries((cached?.episodes || []).map(ep => [ep.url, ep]));
  const result = await readNovel(url, { ...options, cachedEpisodes, refreshExisting: Boolean(options.refreshExisting) });
  const payload = { ...result, cache: { savedAt: new Date().toISOString(), reusedEpisodes: result.episodes.filter(ep => ep.cached).length } };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function getNovelCache(url, config) {
  const file = cachePath(url, config);
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function listNovelCache(config) {
  const directory = resolveAllowedPath(path.join(config.cacheDir, "novels"), config);
  try {
    const names = await fs.readdir(directory);
    const out = [];
    for (const name of names.filter(name => name.endsWith(".json")).slice(0, 500)) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
        out.push({ title: data.title, author: data.author, workUrl: data.workUrl, fetchedEpisodes: data.fetchedEpisodes, complete: data.complete, savedAt: data.cache?.savedAt });
      } catch {}
    }
    return out;
  } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}
