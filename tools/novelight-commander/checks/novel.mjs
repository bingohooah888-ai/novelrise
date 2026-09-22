import assert from "node:assert/strict";
import test from "node:test";
import {
  detectNovelSite,
  extractCaitaEpisodeDocument,
  extractCaitaSeriesDocument
} from "../src/novel.js";

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
    detectNovelSite("https://caita.ai/viewer/episode/01K1YV5ES9H3AEH3C3F2WAD7WV"),
    "caita"
  );
  assert.equal(
    detectNovelSite("https://caita.ai/series/01KHNWNRRVN7DDJ4QFZN71RPAS"),
    "caita"
  );
  assert.equal(
    detectNovelSite("https://example.com/story"),
    "generic"
  );
});


test("extracts Caita series metadata and episode links", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="テスト連載">
        <meta property="og:description" content="テストあらすじ">
      </head>
      <body>
        <a href="/timeline/profile/test-author">テスト作者</a>
        <a href="/viewer/episode/01K1YV5ES9H3AEH3C3F2WAD7WV">第一話</a>
        <a href="/viewer/episode/01K1YV5ES9H3AEH3C3F2WAD7WV">重複リンク</a>
        <a href="/viewer/episode/01K1YV5ES9H3AEH3C3F2WAD7WX">第二話</a>
      </body>
    </html>
  `;
  const result = extractCaitaSeriesDocument(
    html,
    "https://caita.ai/series/01KHNWNRRVN7DDJ4QFZN71RPAS"
  );
  assert.equal(result.title, "テスト連載");
  assert.equal(result.author, "テスト作者");
  assert.equal(result.synopsis, "テストあらすじ");
  assert.equal(result.episodes.length, 2);
});

test("extracts Caita episode body without surrounding viewer controls", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="9. テストエピソード"></head>
      <body>
        <main>
          <nav>登場人物 コメント一覧</nav>
          <a href="/series/01KHNWNRRVN7DDJ4QFZN71RPAS">テスト連載</a>
          <div class="episode-body">
            <p>これは公開本文の一段落目です。十分な長さを持つテスト用の文章です。</p>
            <p>これは公開本文の二段落目です。抽出対象だけが返ることを確認します。</p>
          </div>
        </main>
      </body>
    </html>
  `;
  const result = extractCaitaEpisodeDocument(
    html,
    "https://caita.ai/viewer/episode/01K1YV5ES9H3AEH3C3F2WAD7WV"
  );
  assert.equal(result.title, "9. テストエピソード");
  assert.match(result.body, /公開本文の一段落目/);
  assert.doesNotMatch(result.body, /登場人物/);
  assert.equal(
    result.seriesUrl,
    "https://caita.ai/series/01KHNWNRRVN7DDJ4QFZN71RPAS"
  );
  assert.equal(result.seriesTitle, "テスト連載");
});
