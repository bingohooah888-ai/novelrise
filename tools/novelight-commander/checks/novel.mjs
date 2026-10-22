import assert from "node:assert/strict";
import test from "node:test";
import { detectNovelSite, parseKakuyomuIndexHtml } from "../src/novel.js";

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


test("Caita episode URLs traverse the series and only report complete at a verified end", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/novel.js", import.meta.url), "utf8")
  );
  assert.match(source, /readCaitaNovel/);
  assert.match(source, /totalEpisodesHint/);
  assert.match(source, /reachedKnownTotal/);
  assert.match(source, /reachedNaturalSeriesEnd/);
  assert.match(source, /truncated: !complete/);
});


test("Alphapolis reader falls back to browser-rendered index and body DOM", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/novel.js", import.meta.url), "utf8")
  );
  assert.match(source, /parseAlphapolisIndexHtml/);
  assert.match(source, /parseAlphapolisEpisodeHtml/);
  assert.match(source, /renderAlphapolisHtml/);
  assert.match(source, /dumpDomWithBrowser/);
  assert.match(source, /openVisibleBrowserSession/);
  assert.match(source, /after static and browser-rendered reads/);
});


function kakuyomuFixture({
  workId = "123456789", episodeCount = 12, visibleLinks = 3,
  reportedCount = episodeCount, nested = false
} = {}) {
  const root = "https://kakuyomu.jp/works/" + workId;
  const apollo = {
    ["Work:" + workId]: {
      __typename: "Work",
      title: "Test novel",
      publicEpisodeCount: reportedCount,
      author: { __ref: "User:author1" },
      tableOfContentsV2: [
        { __ref: "TableOfContentsChapter:one" },
        { __ref: "TableOfContentsChapter:two" }
      ]
    },
    "User:author1": { activityName: "Test author" },
    "TableOfContentsChapter:one": {
      __typename: "TableOfContentsChapter", episodeUnions: []
    },
    "TableOfContentsChapter:two": {
      __typename: "TableOfContentsChapter", episodeUnions: []
    }
  };
  for (let i = 1; i <= episodeCount; i += 1) {
    const id = String(900000 + i);
    const ref = "Episode:" + id;
    apollo[ref] = { id, title: "第" + i + "話", __typename: "Episode" };
    const chapter = i <= Math.ceil(episodeCount / 2)
      ? apollo["TableOfContentsChapter:one"]
      : apollo["TableOfContentsChapter:two"];
    chapter.episodeUnions.push({ __ref: ref });
  }
  if (nested) {
    apollo["TableOfContentsChapter:one"].children = [
      { __ref: "TableOfContentsChapter:nested" }
    ];
    apollo["TableOfContentsChapter:nested"] = {
      __typename: "TableOfContentsChapter",
      episodeUnions: [{ __ref: "EmptyEpisode:empty" }]
    };
    apollo["EmptyEpisode:empty"] = { __typename: "EmptyEpisode" };
  }
  const data = { props: { pageProps: { __APOLLO_STATE__: apollo } } };
  const html =
    '<html><body><h1>Fallback title</h1><p>連載中 全' + reportedCount + '話</p>' +
    Array.from({ length: visibleLinks }, (_, index) =>
      '<a href="/works/' + workId + '/episodes/' + (900001 + index) + '">preview</a>'
    ).join("") +
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify(data) + '</script></body></html>';
  return { html, root, apollo };
}

test("Kakuyomu indexes all 432 episodes despite only three visible preview links", () => {
  const { html, root } = kakuyomuFixture({ episodeCount: 432 });
  const parsed = parseKakuyomuIndexHtml(html, root);
  assert.equal(parsed.episodes.length, 432);
  assert.equal(parsed.totalEpisodesHint, 432);
  assert.equal(parsed.author, "Test author");
  assert.equal(parsed.episodes[0].url, root + "/episodes/900001");
  assert.equal(parsed.episodes[431].url, root + "/episodes/900432");
});

test("Kakuyomu supports short works and nested chapters without empty episodes", () => {
  const { html, root } = kakuyomuFixture({ episodeCount: 8, nested: true });
  const parsed = parseKakuyomuIndexHtml(html, root);
  assert.deepEqual(parsed.episodes.map(episode => episode.label),
    Array.from({ length: 8 }, (_, i) => "第" + (i + 1) + "話"));
});

test("Kakuyomu fails closed when the listed count and discovered count disagree", () => {
  const { html, root } = kakuyomuFixture({ episodeCount: 3, reportedCount: 432 });
  assert.throws(
    () => parseKakuyomuIndexHtml(html, root),
    /incomplete episode index: expected 432, discovered 3/
  );
});

test("Kakuyomu does not mistake a three-link HTML preview for a complete index", () => {
  const { html, root } = kakuyomuFixture({ episodeCount: 432 });
  const withoutNextData = html.replace(/<script id="__NEXT_DATA__"[^>]*>[\s\S]*?<\/script>/, "");
  assert.throws(
    () => parseKakuyomuIndexHtml(withoutNextData, root),
    /complete episode index was not found/
  );
});

test("Kakuyomu rejects damaged embedded metadata instead of silently falling back", () => {
  const { root } = kakuyomuFixture();
  const html = '<html><body>全12話<script id="__NEXT_DATA__">{bad}</script></body></html>';
  assert.throws(
    () => parseKakuyomuIndexHtml(html, root),
    /embedded episode index could not be parsed/
  );
});

test("Kakuyomu allows a legacy HTML index only when its episode count is verified", () => {
  const { html, root } = kakuyomuFixture({ episodeCount: 3, visibleLinks: 3 });
  const withoutNextData = html.replace(/<script id="__NEXT_DATA__"[^>]*>[\s\S]*?<\/script>/, "");
  const parsed = parseKakuyomuIndexHtml(withoutNextData, root);
  assert.equal(parsed.episodes.length, 3);
  assert.equal(parsed.totalEpisodesHint, 3);
});
