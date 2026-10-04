import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import prettier from "prettier";

const root = resolve(import.meta.dirname, "..");
const file = "api/_lib/admin-trust-safety.js";

test("emit minimal prettier delta for Trust & Safety helper", async () => {
  const source = readFileSync(resolve(root, file), "utf8");
  const formatted = await prettier.format(source, { filepath: file });

  let prefix = 0;
  while (
    prefix < source.length &&
    prefix < formatted.length &&
    source[prefix] === formatted[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < source.length - prefix &&
    suffix < formatted.length - prefix &&
    source[source.length - 1 - suffix] === formatted[formatted.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const sourceEnd = source.length - suffix;
  const formattedEnd = formatted.length - suffix;
  const payload = {
    prefix,
    suffix,
    sourceMiddle: source.slice(prefix, sourceEnd),
    formattedMiddle: formatted.slice(prefix, formattedEnd),
  };
  console.log(`TRUST_FORMAT_DELTA ${JSON.stringify(payload)}`);
});
