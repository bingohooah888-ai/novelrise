# NLO Google Search Console URL Inspection (read-only)

**STATUS: CURRENT**

NOVELIGHT Commander用のGoogle Search Console URL検査アダプター。対象は公式ドメインのURLに限る。Google公式のURL Inspection APIを使い、Googleに登録済みの**インデックス版**の状態を確認する。ライブURLテスト、再クロール依頼、インデックス登録リクエスト、Search Consoleの設定変更は**行わない**。

## 先に必要なもの

- Google Search Console側で https://novelight.jp/ または sc-domain:novelight.jp のプロパティへのアクセス権
- Google OAuth 2.0で取得した**短命のアクセストークン**。要求スコープは `https://www.googleapis.com/auth/webmasters.readonly`
- 設定済みのGoogle認証情報をNLO実行環境に渡すこと。チャット、GitHub Issue、PR、コード、ログ、テストfixtureにトークンを書き込まない。

本アダプター単体は**認証・トークン発行・更新を自動化しない**。既存の認証済みNLO環境から環境変数 `NLO_GSC_ACCESS_TOKEN` でトークンを受け取る。未設定時には `authorization_required` を返し、登録済みと偽らない。

```sh
# トークンは既存の認証済み実行環境で、安全に環境変数へ供給する
node scripts/nlo-gsc-inspection.mjs sites
node scripts/nlo-gsc-inspection.mjs inspect --site=sc-domain:novelight.jp --url=https://novelight.jp/
# URLプレフィックス形式のプロパティの場合:
node scripts/nlo-gsc-inspection.mjs inspect --site=https://novelight.jp/ --url=https://novelight.jp/
```

`sites` は許可されたNOVELIGHTのプロパティのみ表示する。実際の登録プロパティの種類を確認してから `--site` に渡す。権限不足・期限切れ・API制限は明示的なエラーになり、トークンやGoogleの生エラー本文は表示しない。

## 取得結果

JSON出力: `indexStatus` は `indexed` / `not_indexed` / `unknown`、Googleの `verdict`、`coverageState`、`lastCrawlTime`、`googleCanonical`、`userCanonical`、`robotsTxtState`、`indexingState`、`pageFetchState`、`sitemaps` とSearch Consoleの検査画面リンク。

このAPIが示すのはGoogleの**インデックス版**であり、公開サイトの現在のクロール可否や、検索順位をリアルタイムで確認するものではない。ブランド名での上位表示も保証しない。

## NLOの安全境界

- 既存のNLO能力台帳に `testing` として登録する。現段階では勝手に有効化しない。
- GoogleのOAuth接続、権限確認、機密トークン管理はTier C扱い。ユーザーの明示的な承認や必要な認証設定なしには権限を取得しない。
- NLO #1837 Bridgeのallowlistは変更しない（任意コマンド実行や機密情報のGitHub転送を増やさない）。
- Preview/Staging・Production DB・本番設定は変更しない。

## 関連文書

Google公式: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
OAuthスコープ: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing

テスト: `node --test tests/nlo-gsc-inspection.test.mjs`

## #1837 NLO Bridgeからの接続（ローカル認証）

別モジュール `tools/novelight-commander/src/gsc-readonly-bridge.js` は、`gsc_index_inspect` をGitHub Bridgeの固定allowlistに追加する。実行は **OWNERコメント+空argsのみ** とし、対象URLは `https://novelight.jp/` 固定。任意コマンド、任意URL、読み書き可能なGoogleスコープ、トークンのGitHub送信は禁止する。

ローカルNLOの認証方法は以下のいずれか。

1. 既存で許可済みの短命アクセストークンをNLOの環境変数 `NLO_GSC_ACCESS_TOKEN` に安全に供給する。GitHubやチャットには貼らない。
2. Google Cloud CLI（`gcloud`）をNLO PCへインストールし、ユーザーが自分のブラウザーで `gcloud auth application-default login --client-id-file=<LOCAL_OAUTH_CLIENT_JSON> --scopes=https://www.googleapis.com/auth/webmasters.readonly` を実行して権限許可する。**OAuthクライアントIDはGoogle Cloud側で別途作成し、Search Console APIを有効化する必要がある。** この操作は既存ADCの認証情報を上書きし得るため、他のGoogle Cloud開発作業への影響に注意する。

Google CLIの `print-access-token` はNLOプロセスがローカルで呼び出し、結果をメモリ内だけで使う。NLOがGoogleにログインする動作ではない。Googleによる所有者認証は利用者のGoogleアカウントで行う。

明示的にローカル環境変数 `NLO_GSC_BRIDGE_READONLY_ENABLED=true` を設定するまでは、Bridgeアクションは `gsc_bridge_not_authorized` を返す。これは**デフォルト拒否**であり、ソースコードのmergeだけでは実行権限を付与しない。

認証・ローカル設定・ユーザー承認完了後の固定Bridge要求形式:

```text
NOVELIGHT_COMMANDER_REQUEST {"version":1,"requestId":"cmdr-20261011T150000Z-gsc-readonly-home","action":"gsc_index_inspect","args":{}}
```

返すのはGoogle URL Inspectionの公開トップページに関する登録判定・クロール時刻・canonical等の限定フィールドのみ。トークン、認証ファイル、Google API生レスポンス、任意ページ本文は返さない。

**状態**: 接続実績未確認、NLO capability registryは `testing` を維持する。Googleログイン、Bridge自身の更新と実行は個別に権限・可用性確認が必要。
