import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("novelight-scout-record.css", "utf8");

test("Reader Easy artwork keeps its sprite background image", () => {
  const rule = styles.match(
    /body\.novelight-page-scout-record \.badge-icon-artwork\{([\s\S]*?)\n\}/u,
  );

  assert.ok(rule, "Badge artwork emphasis rule is missing");
  assert.doesNotMatch(
    rule[1],
    /(?:^|[;\n]\s*)background\s*:/u,
    "background shorthand resets the Reader Easy sprite background-image",
  );
  assert.match(rule[1], /background-color:transparent!important/u);
  assert.match(
    styles,
    /\.badge-icon-sprite\{[\s\S]*?background-image:url\('assets\/scout-reader-easy-badges\.webp'\)/u,
  );
});
