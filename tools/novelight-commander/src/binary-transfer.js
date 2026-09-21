import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAllowedPath } from "./security.js";

const sessions = new Map();
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

export async function beginBinaryWrite(file, options, config) {
  const target = resolveAllowedPath(file, config);
  if (!options.overwrite) {
    try { await fs.access(target); throw new Error("Target exists. Set overwrite=true explicitly."); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const id = crypto.randomUUID();
  const temp = resolveAllowedPath(path.join(".novelight-commander","transfers",id + ".part"), config);
  await fs.mkdir(path.dirname(temp), { recursive: true });
  await fs.writeFile(temp, Buffer.alloc(0));
  const session = {
    id, target, temp, overwrite:Boolean(options.overwrite), expectedSize:options.expectedSize ?? null,
    expectedSha256:options.expectedSha256 ? String(options.expectedSha256).toLowerCase() : null,
    receivedBytes:0, nextIndex:0, startedAt:new Date().toISOString()
  };
  sessions.set(id, session);
  return publicSession(session);
}

function publicSession(s) {
  return { id:s.id, target:s.target, expectedSize:s.expectedSize, expectedSha256:s.expectedSha256, receivedBytes:s.receivedBytes, nextIndex:s.nextIndex, startedAt:s.startedAt };
}

export async function appendBinaryChunk(id, index, base64) {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown binary transfer session.");
  if (index !== s.nextIndex) throw new Error("Unexpected chunk index. Expected " + s.nextIndex + ".");
  const chunk = Buffer.from(String(base64 || ""), "base64");
  if (!chunk.length || chunk.length > MAX_CHUNK_BYTES) throw new Error("Binary chunk must be between 1 byte and 2 MiB.");
  await fs.appendFile(s.temp, chunk);
  s.receivedBytes += chunk.length;
  s.nextIndex += 1;
  if (s.expectedSize != null && s.receivedBytes > s.expectedSize) throw new Error("Received bytes exceed expected size.");
  return publicSession(s);
}

export async function finishBinaryWrite(id) {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown binary transfer session.");
  const data = await fs.readFile(s.temp);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  if (s.expectedSize != null && data.length !== s.expectedSize) throw new Error("Size mismatch: got " + data.length + ", expected " + s.expectedSize);
  if (s.expectedSha256 && sha256 !== s.expectedSha256) throw new Error("SHA-256 mismatch.");
  await fs.mkdir(path.dirname(s.target), { recursive:true });
  if (s.overwrite) {
    try { await fs.rm(s.target, { force:true }); } catch {}
  }
  await fs.rename(s.temp, s.target);
  sessions.delete(id);
  return { file:s.target, size:data.length, sha256 };
}

export async function cancelBinaryWrite(id) {
  const s = sessions.get(id);
  if (!s) return { cancelled:false };
  await fs.rm(s.temp, { force:true });
  sessions.delete(id);
  return { cancelled:true, id };
}

export function listBinaryWrites() { return [...sessions.values()].map(publicSession); }

export async function readBinaryChunk(file, offset, length, config) {
  const absolute = resolveAllowedPath(file, config);
  const stat = await fs.stat(absolute);
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Math.min(MAX_CHUNK_BYTES, Number(length) || 1024 * 1024));
  const handle = await fs.open(absolute, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, Math.max(0, stat.size - start)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return { file:absolute, offset:start, bytesRead, totalSize:stat.size, eof:start + bytesRead >= stat.size, base64:buffer.subarray(0,bytesRead).toString("base64") };
  } finally { await handle.close(); }
}
