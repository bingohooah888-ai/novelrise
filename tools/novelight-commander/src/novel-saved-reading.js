import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SAVED_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_CHARS = 100_000;
const REQUEST_ID = /^cmdr-[A-Za-z0-9T_-]{8,80}$/;
const HASH_ID = /^[a-f0-9]{64}$/;
const PROOF_ID = /^(novelight-pr[0-9]+-bodyproof-[0-9]{8})\/([A-Za-z0-9_-]+\.json)$/;

async function bridgeRoot() {
  const configFile = process.env.NOVELIGHT_BRIDGE_CONFIG ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "NOVELIGHT", "commander-bridge", "config.json");
  try {
    const config = JSON.parse(await fs.readFile(configFile, "utf8"));
    if (config.owner !== "bingohooah888-ai" || config.repository !== "novelrise") {
      throw new Error("NLO Bridge configuration identity mismatch.");
    }
    return path.resolve(String(config.dataRoot || path.join(os.homedir(), "Documents", "NOVELIGHT-Bridge")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return path.join(os.homedir(), "Documents", "NOVELIGHT-Bridge");
  }
}

function cacheRoot(config) {
  const base = path.resolve(config.primary);
  const dir = path.resolve(base, config.cacheDir, "novels");
  const relative = path.relative(base, dir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Novel cache is outside the allowed NLO root.");
  }
  return dir;
}

export async function resolveSavedNovelLocation(source, id, config, roots = {}) {
  let root;
  let filename;
  if (source === "bridge") {
    if (!REQUEST_ID.test(String(id))) throw new Error("Invalid saved novel request ID.");
    root = path.join(roots.bridge || await bridgeRoot(), "novels");
    filename = id + ".json";
  } else if (source === "cache") {
    if (!HASH_ID.test(String(id))) throw new Error("Invalid novel cache ID.");
    root = roots.cache || cacheRoot(config);
    filename = id + ".json";
  } else if (source === "proof") {
    const match = String(id || "").match(PROOF_ID);
    if (!match) throw new Error("Invalid local proof reference.");
    const tempRoot = roots.proof || os.tmpdir();
    root = path.join(tempRoot, match[1]);
    filename = match[2];
  } else {
    throw new Error("Unsupported saved novel source.");
  }
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Saved novel directory is not a real directory.");
  }
  const target = path.join(root, filename);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.size <= 0 || stat.size > MAX_SAVED_BYTES) {
    throw new Error("Saved novel must be a regular JSON file within the size limit.");
  }
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  const relative = path.relative(realRoot, realTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error("Saved novel path escapes its source directory.");
  }
  return target;
}

function describeNovel(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.episodes) ||
      data.episodes.length > 1000) {
    throw new Error("Invalid saved novel episode collection.");
  }
  const episodes = data.episodes;
  const urls = episodes.map(e => String(e?.url || ""));
  const uniqueUrls = new Set(urls);
  const bodyEpisodes = episodes.filter(e => typeof e?.body === "string" &&
    e.body.trim().length > 0).length;
  const reported = Number(data.discoveredEpisodes);
  const contiguous = episodes.every((e, i) => Number(e?.number) === i + 1);
  const expectedKnown = Number.isInteger(reported) && reported > 0;
  const failures = Array.isArray(data.failures) ? data.failures.length : -1;
  const verifiedFull = data.complete === true &&
    expectedKnown && reported === episodes.length &&
    Number(data.fetchedEpisodes) === episodes.length &&
    failures === 0 && contiguous && bodyEpisodes === episodes.length &&
    uniqueUrls.size === episodes.length && urls.every(Boolean);
  return {
    title: String(data.title || ""),
    author: String(data.author || ""),
    workUrl: String(data.workUrl || ""),
    discoveredEpisodes: expectedKnown ? reported : null,
    savedEpisodes: episodes.length,
    uniqueEpisodeUrls: uniqueUrls.size,
    bodyEpisodes,
    bodyChars: episodes.reduce((sum, e) => sum + (typeof e?.body === "string" ? e.body.length : 0), 0),
    failures,
    sequenceComplete: contiguous,
    verifiedFull,
    // Data availability is not evidence that the model has read it.
    readByAssistant: false
  };
}

export async function loadSavedNovel(source, id, config, roots = {}) {
  const file = await resolveSavedNovelLocation(source, id, config, roots);
  const raw = await fs.readFile(file, "utf8");
  const data = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  const manifest = describeNovel(data);
  const contentSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  return { data, manifest: { source, id, ...manifest, contentSha256 } };
}

export async function listSavedNovelSources(config, roots = {}) {
  const output = [];
  const locations = [
    { source: "bridge", root: path.join(roots.bridge || await bridgeRoot(), "novels") },
    { source: "cache", root: roots.cache || cacheRoot(config) }
  ];
  const proofBase = roots.proof || os.tmpdir();
  const proofDirectories = await fs.readdir(proofBase, { withFileTypes: true }).catch(e => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  for (const entry of proofDirectories.filter(e =>
    e.isDirectory() && /^novelight-pr[0-9]+-bodyproof-[0-9]{8}$/.test(e.name)).slice(0, 20)) {
    locations.push({ source: "proof", root: path.join(proofBase, entry.name), folder: entry.name });
  }
  for (const location of locations) {
    const files = await fs.readdir(location.root, { withFileTypes: true }).catch(e => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    for (const entry of files.filter(e => e.isFile() && e.name.endsWith(".json")).slice(0, 100)) {
      const id = location.source === "proof" ? location.folder + "/" + entry.name :
        entry.name.slice(0, -5);
      try {
        const novel = await loadSavedNovel(location.source, id, config, roots);
        output.push(novel.manifest);
      } catch {
        // Ignore invalid local saved artifacts without exposing their contents.
      }
    }
  }
  return output;
}

export async function readSavedNovelChunk(args, config, roots = {}) {
  const { source, id } = args;
  const episodeNumber = args.episodeNumber ?? 1;
  const charOffset = args.charOffset ?? 0;
  const maxChars = args.maxChars ?? 60_000;
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1 ||
      !Number.isInteger(charOffset) || charOffset < 0 ||
      !Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_CHUNK_CHARS) {
    throw new Error("Invalid saved novel reading cursor.");
  }
  const { data, manifest } = await loadSavedNovel(source, id, config, roots);
  if (args.expectedSha256 && args.expectedSha256 !== manifest.contentSha256) {
    throw new Error("Saved novel changed since the previous reading chunk.");
  }
  if (episodeNumber > data.episodes.length) {
    throw new Error("Reading cursor is outside saved episodes.");
  }
  const first = data.episodes[episodeNumber - 1];
  if (charOffset > String(first.body || "").length) {
    throw new Error("Reading offset exceeds the episode body.");
  }
  let remaining = maxChars;
  let current = episodeNumber;
  let offset = charOffset;
  const segments = [];
  while (current <= data.episodes.length && remaining > 0) {
    const episode = data.episodes[current - 1];
    if (typeof episode?.body !== "string" || !episode.body.trim()) {
      throw new Error("Cannot claim reading coverage: episode " + current + " has no body.");
    }
    const body = episode.body;
    const startOffset = offset;
    let endOffset = Math.min(body.length, startOffset + remaining);
    if (endOffset < body.length && endOffset > startOffset &&
        /[\uD800-\uDBFF]/u.test(body[endOffset - 1])) endOffset -= 1;
    if (endOffset === startOffset) break;
    segments.push({
      episodeNumber: current,
      title: String(episode.title || ""),
      startOffset,
      endOffset,
      episodeChars: body.length,
      text: body.slice(startOffset, endOffset)
    });
    remaining -= endOffset - startOffset;
    if (endOffset < body.length) {
      offset = endOffset;
      break;
    }
    current += 1;
    offset = 0;
  }
  const nextCursor = current > data.episodes.length ? null :
    { episodeNumber: current, charOffset: offset };
  if (!segments.length) throw new Error("Reading cursor could not advance.");
  return {
    manifest,
    segments,
    charsReturned: maxChars - remaining,
    nextCursor,
    // Only when all cursors are followed to null can coverage be claimed.
    reachedSavedEnd: nextCursor === null,
    coversCompleteWork: nextCursor === null && manifest.verifiedFull &&
      episodeNumber === 1 && charOffset === 0
  };
}
