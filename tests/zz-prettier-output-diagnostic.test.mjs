import fs from "node:fs";
import test from "node:test";
import prettier from "prettier";

const files = [
  "api/_lib/admin-trust-safety.js",
  "api/admin-trust-safety.js",
  "tests/admin-trust-safety-api.test.mjs",
  "tests/admin-trust-safety-page.test.mjs",
  "tests/trust-safety-migration-contract.test.mjs",
];

test("emit exact Prettier 3.9.8 output for Trust & Safety files", async () => {
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const formatted = await prettier.format(source, { filepath: file });
    const encoded = Buffer.from(formatted, "utf8").toString("base64");
    const chunks = encoded.match(/.{1,3000}/g) ?? [];
    chunks.forEach((chunk, index) => {
      console.log(`PRETTIER_OUTPUT|${file}|${index + 1}|${chunks.length}|${chunk}`);
    });
  }
});
