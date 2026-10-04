import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import prettier from "prettier";

const root = resolve(import.meta.dirname, "..");
const files = [
  "api/_lib/admin-trust-safety.js",
  "api/admin-trust-safety.js",
  "tests/admin-trust-safety-api.test.mjs",
  "tests/admin-trust-safety-page.test.mjs",
  "tests/trust-safety-migration-contract.test.mjs",
];
const chunkSize = 1800;

test("emit compressed canonical prettier output for Trust & Safety files", async () => {
  const payload = {};
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    payload[file] = await prettier.format(source, { filepath: file });
  }
  const encoded = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), {
    level: 9,
    mtime: 0,
  }).toString("base64");
  const count = Math.ceil(encoded.length / chunkSize);
  for (let index = 0; index < count; index += 1) {
    const chunk = encoded.slice(index * chunkSize, (index + 1) * chunkSize);
    console.log(`TRUST_FORMAT_GZIP ${index + 1}/${count} ${chunk}`);
  }
});
