import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets, resolveAllowedPath } from "./security.js";

export async function appendAudit(config, event, details = {}) {
  const file = resolveAllowedPath(config.auditFile, config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const record = {
    ts: new Date().toISOString(),
    event,
    details: JSON.parse(redactSecrets(JSON.stringify(details)))
  };
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
  return record;
}

export async function readAudit(config, limit = 100) {
  const file = resolveAllowedPath(config.auditFile, config);
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(1000, limit))).map(line => {
      try { return JSON.parse(line); } catch { return { malformed: line }; }
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
