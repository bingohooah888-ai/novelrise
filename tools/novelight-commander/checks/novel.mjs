import assert from "node:assert/strict";
import test from "node:test";
import { detectNovelSite } from "../src/novel.js";

test("detects novel sites", () => {
  assert.equal(
    detectNovelSite("https://ncode.syosetu.com/n2052ma/"),
    "narou"
  );
  assert.equal(
    detectNovelSite(
      "https://kakuyomu.jp/works/2912051607872484996"
    ),
    "kakuyomu"
  );
  assert.equal(
    detectNovelSite(
      "https://www.alphapolis.co.jp/novel/896143584/366155583"
    ),
    "alphapolis"
  );
  assert.equal(
    detectNovelSite(
      "https://www.alphapolis.co.jp/novel/896143584/366155583/episode/123456"
    ),
    "alphapolis"
  );
  assert.equal(
    detectNovelSite("https://example.com/story"),
    "generic"
  );
});


test("Caita episode URLs are not treated as whole-series reads", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/novel.js", import.meta.url), "utf8")
  );
  assert.match(source, /partial:\s*true/);
  assert.match(source, /totalEpisodesHint/);
  assert.match(source, /!index\.partial/);
});
