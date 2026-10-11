# NLO Google Search Console URL Inspection (read-only)

NOVELIGHT Commander用のGoogle Search Console URL検査アダプター。対象は公式ドメインのURLに限る。Google公式のURL Inspection APIを使い、Googleに登録済みの**インデックス版**の状態を確認する。ライブURLテスト、再クロール依頼、インデックス登録リクエスト、Search Consoleの設定変更は**行わない**。

## 先に必要なもの

- Google Search Console側で https://novelight.jp/ または sc-domain:novelight.jp のプロパティへのアクセス権
- Google OAuth 2.0で取得した**短命のアクセストークン**。要求スコープは \`https://www.googleapis.com/auth/webmasters.readonly\`
- 設定済みのGoogle認証情報をNLO実行環境に渡すこと。チャット、GitHub Issue、PR、コード、ログ、テストfixtureにトークンを書き込まない。

本アダプターは**認証・トークン発行・更新を自動化しない**。既存の認証済みNLO環境から環境変数 \`NLO_GSC_ACCESS_TOKEN\` でトークンを受け取る。未設定時には \`authorization_required\` を返し、登録済みと偽らない。

\`\`\`sh
# トークンは既存の認証済み実行環境で、安全に環境変数へ供給する
node scripts/nlo-gsc-inspection.mjs sites
node scripts/nlo-gsc-inspection.mjs inspect --site=sc-domain:novelight.jp --url=https://novelight.jp/
# URLプレフィックス形式のプロパティの場合:
node scripts/nlo-gsc-inspection.mjs inspect --site=https://novelight.jp/ --url=https://novelight.jp/
\`\`\`

\`sites\` は許可されたNOVELIGHTのプロパティのみ表示する。実際の登録プロパティの種類を確認してから \`--site\` に渡す。権限不足・期限切れ・API制限は明示的なエラーになり、トークンやGoogleの生エラー本文は表示しない。

## 取得結果

JSON出力: \`indexStatus\` は \`indexed\` / \`not_indexed\` / \`unknown\`、Googleの \`verdict\`、\`coverageState\`、\`lastCrawlTime\`、\`googleCanonical\`、\`userCanonical\`、\`robotsTxtState\`、\`indexingState\`、\`pageFetchState\`、\`sitemaps\` とSearch Consoleの検査画面リンク。

このAPIが示すのはGoogleの**インデックス版**であり、公開サイトの現在のクロール可否や、検索順位をリアルタイムで確認するものではない。ブランド名での上位表示も保証しない。

## NLOの安全境界

- 既存のNLO能力台帳に \`testing\` として登録する。現段階では勝手に有効化しない。
- GoogleのOAuth接続、権限確認、機密トークン管理はTier C扱い。ユーザーの明示的な承認や必要な認証設定なしには権限を取得しない。
- NLO #1837 Bridgeのallowlistは変更しない（任意コマンド実行や機密情報のGitHub転送を増やさない）。
- Preview/Staging・Production DB・本番設定は変更しない。

## 関連文書

Google公式: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
OAuthスコープ: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing

テスト: \`node --test tests/nlo-gsc-inspection.test.mjs\`
