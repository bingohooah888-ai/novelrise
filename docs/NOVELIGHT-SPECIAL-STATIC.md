# NOVELIGHT SPECIAL — 簡易・静的ページ運用

このPRは特別企画の「一覧と個別紹介ページ」だけを実装する。
運営からチャッピーに依頼してGitHubのデータを更新する運用とする。
**専用ADMIN画面、Supabase migration、権利証跡DB、独立集計API、Preview/Stagingは作らない。**

## ページ
- `special.html`：公開中の特別企画一覧。公開企画が0件なら正直な空表示。
- `special-detail.html?slug=<slug>`：企画紹介と既存の作品/エピソードへのリンク。
- トップページに「特別企画を見る」導線を配置。

## 企画の追加・修正のやり方
`novelight-special-data.js` 内の `specialProjects` 配列を編集。
追加時はユニークな英数字+ハイフンのslug、表示title・summary、
`status: 'draft'`、紹介用body配列、任意のauthorName/category、
`links: [{label,href}]` を指定する。許諾・作品URL・年齢区分を確認した後で
`published` に変更。公開前にはレビューと本番反映承認を得る。
終了するときは `draft` に戻す（一覧・個別紹介から同時に消える）。
リンク先は既存NOVELIGHT作品・エピソード（本文・年齢確認は元ページ）または
httpsの公式リンク。独自本文コピーや年齢制限を迂回する表示は行わない。
画像は許諾/素材管理の合意ができるまで専用アップロードしない。

## 最低限の検証と権限境界
- `node --test tests/special-static.test.mjs` と既存の構造チェック・CI。
- 公開ページのテキスト・リンク・モバイル表示を確認する。
- 本番merge/deployは明示的な `本番承認` が必要。
- 静的データ変更にはStaging/DBマイグレーションは不要。
- 新規データに架空の掲載作品を追加しない。

## 旧PRの置換
PR #2442（データベース・管理コンソール方式）とは別実装。
その変更は持ち込まない。旧PRは重複採用しないよう終了する。
