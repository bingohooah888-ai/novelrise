import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import { listSavedNovelSources, loadSavedNovel, readSavedNovelChunk } from "../src/novel-saved-reading.js";

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nlo-novel-reading-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proof = path.join(root, "novelight-pr7-bodyproof-20261022");
  await fs.mkdir(proof);
  const id = "novelight-pr7-bodyproof-20261022/example.json";
  const body1 = "Chapter one " + "a".repeat(65_500) + "😀";
  const body2 = "Chapter two " + "b".repeat(18_000);
  const data = {
    title: "Test novel", author: "Test writer", workUrl: "https://example.com/work",
    discoveredEpisodes: 2, fetchedEpisodes: 2,
    complete: true, failures: [],
    episodes: [
      { number: 1, title: "First", url: "https://example.com/e/1", body: body1 },
      { number: 2, title: "Second", url: "https://example.com/e/2", body: body2 }
    ], ...overrides
  };
  await fs.writeFile(path.join(proof, "example.json"), JSON.stringify(data));
  return { root, id, data, roots: { bridge: root, cache: root, proof: root },
    config: { primary: root, cacheDir: "cache" } };
}

test("private novel catalog lists saved proof without publishing story text", async t => {
  const f = await fixture(t);
  const found = await listSavedNovelSources(f.config, f.roots);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, f.id);
  assert.equal(found[0].verifiedFull, true);
  assert.equal(found[0].readByAssistant, false);
  assert.equal(JSON.stringify(found).includes("Chapter one"), false);
});

test("novel reading chunks cover complete text in order and preserve Unicode", async t => {
  const f = await fixture(t);
  let cursor = { episodeNumber: 1, charOffset: 0 };
  let sha = null;
  let output = "";
  let calls = 0;
  while (cursor) {
    const result = await readSavedNovelChunk({
      source: "proof", id: f.id, ...cursor, maxChars: 20_001,
      ...(sha ? { expectedSha256: sha } : {})
    }, f.config, f.roots);
    sha = result.manifest.contentSha256;
    output += result.segments.map(s => s.text).join("");
    cursor = result.nextCursor;
    assert.ok(++calls < 100);
    if (cursor) assert.equal(result.reachedSavedEnd, false);
  }
  assert.equal(output, f.data.episodes.map(e => e.body).join(""));
  assert.equal(calls > 3, true);
});

test("partial saves must never claim entire novel verified", async t => {
  const f = await fixture(t, {
    discoveredEpisodes: 432, fetchedEpisodes: 2, complete: false
  });
  const novel = await loadSavedNovel("proof", f.id, f.config, f.roots);
  assert.equal(novel.manifest.verifiedFull, false);
  assert.equal(novel.manifest.discoveredEpisodes, 432);
  assert.equal(novel.manifest.savedEpisodes, 2);
});

test("content checksum pins the reading session and detects changed files", async t => {
  const f = await fixture(t);
  await assert.rejects(readSavedNovelChunk({
    source: "proof", id: f.id, expectedSha256: "a".repeat(64)
  }, f.config, f.roots), /changed/);
});

test("invalid paths, symlinks and out-of-range cursors are rejected", async t => {
  const f = await fixture(t);
  await assert.rejects(readSavedNovelChunk({
    source: "proof", id: "../example.json"
  }, f.config, f.roots), /Invalid local proof/);
  await assert.rejects(readSavedNovelChunk({
    source: "proof", id: f.id, episodeNumber: 3
  }, f.config, f.roots), /outside saved episodes/);
  await assert.rejects(readSavedNovelChunk({
    source: "proof", id: f.id, charOffset: -1
  }, f.config, f.roots), /Invalid saved novel reading cursor/);
  try {
    const link = path.join(f.root, "novelight-pr7-bodyproof-20261022", "link.json");
    await fs.symlink(path.join(f.root, "novelight-pr7-bodyproof-20261022", "example.json"), link);
    await assert.rejects(readSavedNovelChunk({
      source: "proof", id: "novelight-pr7-bodyproof-20261022/link.json"
    }, f.config, f.roots), /regular JSON/);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  }
});

test("bridge saved JSON is located strictly by request ID", async t => {
  const f = await fixture(t);
  const folder = path.join(f.root, "novels");
  await fs.mkdir(folder);
  const id = "cmdr-20261022T123000Z-readsavedtest";
  await fs.writeFile(path.join(folder, id + ".json"), JSON.stringify(f.data));
  const doc = await loadSavedNovel("bridge", id, f.config, f.roots);
  assert.equal(doc.manifest.verifiedFull, true);
  await assert.rejects(loadSavedNovel("bridge", "../bad", f.config, f.roots), /Invalid saved novel request/);
});
